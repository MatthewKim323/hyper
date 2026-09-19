import { Color, Group, Matrix4, PlaneGeometry, RingGeometry, ShaderMaterial, Vector2, Vector3, Vector4, type BufferGeometry } from "three";
import { Reflector } from "three/examples/jsm/objects/Reflector.js";
import { createWaterRipples, type WaterRipples } from "./ripples";

export type AtriumWater = {
  group: Group;
  update(time: number, delta: number): void;
  splash(worldX: number, worldZ: number, strength?: number): void;
  setPaused(paused: boolean): void;
  resize(width: number, height: number): void;
  dispose(): void;
};

// Shallow gravity-wave spectrum shared with the editable Blender scene. The
// frequency is sqrt(g * k * tanh(k * depth)); amplitudes are in meters.
const WAVES = [
  [0.016, 3.8, 0.22, 0.5], [0.012, 2.35, 1.12, 1.8],
  [0.009, 1.55, -0.64, 3.25], [0.0065, 1.1, 0.55, 4.4],
  [0.004, 0.79, 1.94, 0.85], [0.003, 0.63, -1.36, 2.6],
  [0.002, 0.51, 2.8, 4], [0.0014, 0.43, 0.14, 5.1],
] as const;

const waveShader = WAVES.map(([amplitude, wavelength, angle, phase]) => {
  const k = 2 * Math.PI / wavelength;
  const x = k * Math.cos(angle);
  const z = -k * Math.sin(angle);
  const frequency = Math.sqrt(9.81 * k * Math.tanh(k * 0.42));
  return `addWave(result, point, vec2(${x.toFixed(8)}, ${z.toFixed(8)}), ${amplitude.toFixed(8)}, ${frequency.toFixed(8)}, ${phase.toFixed(8)});`;
}).join("\n");

const waveFunction = `
  void addWave(inout vec3 result, vec2 point, vec2 k, float amplitude, float frequency, float phase) {
    float p = dot(k, point) - frequency * uTime * 0.48 + phase;
    result.x += sin(p) * amplitude;
    result.yz += cos(p) * amplitude * k;
  }
  vec3 gravityWaves(vec2 point) {
    vec3 result = vec3(0.0);
    ${waveShader}
    return result;
  }
`;

const vertexShader = `
  uniform mat4 textureMatrix;
  uniform float uTime;
  uniform float uAmplitude;
  uniform float uRippleAmplitude;
  uniform vec4 uBounds;
  uniform vec2 uRippleTexel;
  uniform sampler2D uRipples;
  varying vec4 vReflection;
  varying vec3 vWorld;
  varying vec2 vGradient;
  #include <common>
  #include <logdepthbuf_pars_vertex>

  float ripple(vec2 point) {
    vec2 packedHeight = texture2D(uRipples, clamp(point, vec2(0.0), vec2(1.0))).rg;
    return ((packedHeight.r * 255.0 * 256.0 + packedHeight.g * 255.0) / 65535.0 - 0.5) * 2.0;
  }
  ${waveFunction}
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vec2 point = world.xz;
    vec3 result = gravityWaves(point) * uAmplitude;
    vec2 uv = (point - uBounds.xy) / uBounds.zw;
    float disturbance = ripple(uv);
    vec2 gradient = vec2(
      ripple(uv + vec2(uRippleTexel.x, 0.0)) - ripple(uv - vec2(uRippleTexel.x, 0.0)),
      ripple(uv + vec2(0.0, uRippleTexel.y)) - ripple(uv - vec2(0.0, uRippleTexel.y))
    ) / (2.0 * uRippleTexel * uBounds.zw);
    float height = result.x + disturbance * uRippleAmplitude;
    vec3 displaced = position + vec3(0.0, 0.0, height);
    vGradient = gradient * uRippleAmplitude;
    vWorld = (modelMatrix * vec4(displaced, 1.0)).xyz;
    vReflection = textureMatrix * vec4(displaced, 1.0);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
    #include <logdepthbuf_vertex>
  }
`;

const fragmentShader = `
  uniform sampler2D tDiffuse;
  uniform vec3 color;
  uniform float uTime;
  uniform float uAmplitude;
  uniform vec3 uSunDirection;
  uniform vec2 uReflectionTexel;
  varying vec4 vReflection;
  varying vec3 vWorld;
  varying vec2 vGradient;
  #include <common>
  #include <logdepthbuf_pars_fragment>

  ${waveFunction}
  float hash(vec2 point) {
    vec3 p = fract(vec3(point.xyx) * 0.1031);
    p += dot(p, p.yzx + 33.33);
    return fract((p.x + p.y) * p.z);
  }
  vec2 noiseGradient(vec2 point) {
    vec2 cell = floor(point), f = fract(point);
    float a = hash(cell), b = hash(cell + vec2(1.0, 0.0));
    float c = hash(cell + vec2(0.0, 1.0)), d = hash(cell + vec2(1.0, 1.0));
    vec2 curve = f * f * (3.0 - 2.0 * f);
    vec2 derivative = 6.0 * f * (1.0 - f);
    return vec2(mix(b - a, d - c, curve.y), mix(c - a, d - b, curve.x)) * derivative;
  }
  vec2 capillaryGradient(vec2 point) {
    mat2 turn = mat2(0.8, -0.6, 0.6, 0.8);
    mat2 inverseTurn = mat2(0.8, 0.6, -0.6, 0.8);
    vec2 p = point * 3.7;
    vec2 drift = vec2(uTime * 0.12, -uTime * 0.08);
    vec2 fine = noiseGradient(p + drift) * 0.014;
    p = turn * p * 2.03 + vec2(17.1, 8.4);
    fine += inverseTurn * noiseGradient(p - drift * 1.37) * 0.007;
    p = turn * p * 2.11 + vec2(3.8, 29.2);
    fine += inverseTurn * inverseTurn * noiseGradient(p + drift * 1.83) * 0.0035;
    return fine;
  }
  void main() {
    #include <logdepthbuf_fragment>
    // Evaluate normals per pixel so short waves do not reveal the geometry grid.
    vec2 gradient = gravityWaves(vWorld.xz).yz * uAmplitude + vGradient + capillaryGradient(vWorld.xz);
    vec3 normal = normalize(vec3(-gradient.x, 1.0, -gradient.y));
    vec3 view = normalize(cameraPosition - vWorld);
    float facing = clamp(dot(normal, view), 0.0, 1.0);
    // Air/water IOR 1.333 gives a normal-incidence reflectance of 0.02037.
    float fresnel = 0.02037 + 0.97963 * pow(1.0 - facing, 5.0);
    vec2 projected = vReflection.xy / max(vReflection.w, 0.0001);
    vec2 distortion = normal.xz * vec2(0.035, 0.045);
    vec2 sampleUv = clamp(projected + distortion, uReflectionTexel, vec2(1.0) - uReflectionTexel);
    // Three r143 writes ordinary render targets in linear encoding, regardless
    // of Reflector's texture.encoding label. Decode again and reflections darken.
    vec3 reflected = texture2D(tDiffuse, sampleUv).rgb;
    vec3 light = uSunDirection;
    vec3 halfDirection = normalize(light + view);
    float halfFacing = max(dot(normal, halfDirection), 0.0);
    float lightFacing = max(dot(normal, light), 0.0);
    // A narrow microfacet lobe retains a soft tail instead of a binary sun dot.
    float alphaSquared = 0.0016;
    float denominator = halfFacing * halfFacing * (alphaSquared - 1.0) + 1.0;
    float distribution = alphaSquared / max(PI * denominator * denominator, 0.00001);
    float sunFresnel = 0.02037 + 0.97963 * pow(1.0 - max(dot(view, halfDirection), 0.0), 5.0);
    float highlight = distribution * sunFresnel * lightFacing / max(4.0 * facing * lightFacing, 0.15);
    vec3 surface = mix(color * 0.9, reflected, 0.48 + fresnel * 0.52);
    surface += vec3(1.0, 0.82, 0.70) * min(highlight, 2.0) * 0.55;
    // Some floor light passes through the water; grazing angles become reflective.
    gl_FragColor = vec4(surface, 0.78 + fresnel * 0.2);
    #include <encodings_fragment>
  }
`;

type Surface = { reflector: Reflector; material: ShaderMaterial; ripples: WaterRipples; bounds: Vector4; captured: boolean };

/** Live geometry and scene reflections. Add group to the scene before rendering. */
export function createAtriumWater(options: { reflectionSize?: number; sunDirection?: Vector3 } = {}): AtriumWater {
  const group = new Group();
  group.name = "Hyper live reflective water";
  const requestedSize = options.reflectionSize ?? 512;
  const maximumSize = Number.isFinite(requestedSize) ? Math.max(64, Math.min(512, Math.round(requestedSize))) : 512;
  const sunDirection = options.sunDirection?.clone() ?? new Vector3(-9, 11, -3);
  if (![sunDirection.x, sunDirection.y, sunDirection.z].every(Number.isFinite) || sunDirection.lengthSq() < 1e-8) sunDirection.set(-9, 11, -3);
  sunDirection.normalize();
  const surfaces: Surface[] = [];
  let reflecting = false;
  let paused = false;
  let disposed = false;

  function addSurface(name: string, geometry: BufferGeometry, y: number, z: number, bounds: Vector4, amplitude: number) {
    const ripples = createWaterRipples();
    const reflector = new Reflector(geometry, {
      textureWidth: maximumSize,
      textureHeight: maximumSize,
      clipBias: 0.003,
      multisample: 0,
      color: new Color(0xc2b5bc).convertSRGBToLinear(),
      shader: {
        uniforms: {
          color: { value: null }, tDiffuse: { value: null }, textureMatrix: { value: new Matrix4() },
          uTime: { value: 0 }, uAmplitude: { value: amplitude }, uRippleAmplitude: { value: amplitude * 0.07 },
          uSunDirection: { value: sunDirection },
          uBounds: { value: bounds }, uRipples: { value: null },
          uRippleTexel: { value: new Vector2(1 / 128, 1 / 72) },
          uReflectionTexel: { value: new Vector2(1 / maximumSize, 1 / maximumSize) },
        },
        vertexShader,
        fragmentShader,
      },
    });
    reflector.name = name;
    reflector.rotation.x = -Math.PI / 2;
    reflector.position.set(0, y, z);
    reflector.frustumCulled = false;
    reflector.renderOrder = -2;
    const material = reflector.material as ShaderMaterial;
    material.uniforms.uRipples.value = ripples.texture;
    material.toneMapped = false;
    material.transparent = true;
    material.depthWrite = false;
    const surface = { reflector, material, ripples, bounds, captured: false };
    const capture = reflector.onBeforeRender;
    reflector.onBeforeRender = (renderer, scene, camera, geometry, material, renderGroup) => {
      if (disposed || reflecting || (paused && surface.captured)) return;
      const wasVisible = group.visible;
      const reflectorVisible = reflector.visible;
      const target = renderer.getRenderTarget();
      const xrEnabled = renderer.xr.enabled;
      const shadowAutoUpdate = renderer.shadowMap.autoUpdate;
      reflecting = true;
      // Hide both surfaces, including during Three's transmission render pass.
      group.visible = false;
      try {
        capture.call(reflector, renderer, scene, camera, geometry, material, renderGroup);
        surface.captured = true;
      } finally {
        renderer.setRenderTarget(target);
        renderer.xr.enabled = xrEnabled;
        renderer.shadowMap.autoUpdate = shadowAutoUpdate;
        group.visible = wasVisible;
        reflector.visible = reflectorVisible;
        reflecting = false;
      }
    };
    surfaces.push(surface);
    group.add(reflector);
    return surface;
  }

  const flooded = addSurface("Water | flooded atrium", new PlaneGeometry(50, 63, 192, 240), 0.015, -3.5, new Vector4(-25, -35, 50, 63), 0.82);
  const basin = addSurface("Water | central reflecting basin", new RingGeometry(0, 4.42, 128, 40), 0.61, 0, new Vector4(-4.42, -4.42, 8.84, 8.84), 0.55);

  return {
    group,
    update(time, delta) {
      if (disposed || paused) return;
      for (const surface of surfaces) {
        if (Number.isFinite(time)) surface.material.uniforms.uTime.value = time;
        surface.ripples.step(delta);
      }
    },
    splash(worldX, worldZ, strength = 0.18) {
      if (disposed || paused || !Number.isFinite(worldX) || !Number.isFinite(worldZ)) return;
      const surface = worldX * worldX + worldZ * worldZ < 4.42 * 4.42 ? basin : flooded;
      const bounds = surface.bounds;
      const u = (worldX - bounds.x) / bounds.z;
      const v = (worldZ - bounds.y) / bounds.w;
      if (u >= 0 && u <= 1 && v >= 0 && v <= 1) surface.ripples.splash(u, v, strength);
    },
    setPaused(value) { paused = value; },
    resize(width, height) {
      if (disposed || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return;
      const scale = Math.min(1, maximumSize / Math.max(width, height));
      const w = Math.max(32, Math.round(width * scale));
      const h = Math.max(32, Math.round(height * scale));
      for (const surface of surfaces) {
        surface.reflector.getRenderTarget().setSize(w, h);
        surface.material.uniforms.uReflectionTexel.value.set(1 / w, 1 / h);
        surface.captured = false;
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const surface of surfaces) {
        surface.ripples.dispose();
        surface.reflector.geometry.dispose();
        surface.reflector.dispose();
      }
      group.clear();
      group.removeFromParent();
    },
  };
}
