import { Color, DepthTexture, Group, HalfFloatType, LinearFilter, Matrix4, Mesh, PlaneGeometry, RingGeometry, ShaderMaterial, UniformsLib, UnsignedIntType, Vector2, Vector3, Vector4, WebGLRenderTarget, type BufferGeometry, type Camera, type Material, type Scene, type WebGLRenderer } from "three";
import { Reflector } from "three/examples/jsm/objects/Reflector.js";
import { createWaterRipples, type WaterRipples } from "./ripples";

export type AtriumWater = {
  group: Group;
  prepareFrame(renderer: WebGLRenderer, scene: Scene, camera: Camera, forceReflections?: boolean): void;
  update(time: number, delta: number): void;
  splash(worldX: number, worldZ: number, strength?: number): void;
  setPaused(paused: boolean): void;
  resize(width: number, height: number): void;
  dispose(): void;
};

// Shallow gravity-wave spectrum shared with the editable Blender scene. The
// frequency is sqrt(g * k * tanh(k * depth)); amplitudes are in meters.
const WAVES = [
  [0.006, 3.8, 0.22, 0.5], [0.005, 2.35, 1.12, 1.8],
  [0.004, 1.55, -0.64, 3.25], [0.0045, 1.1, 0.55, 4.4],
  [0.004, 0.79, 1.94, 0.85], [0.004, 0.63, -1.36, 2.6],
  [0.003, 0.51, 2.8, 4], [0.0024, 0.43, 0.14, 5.1],
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
  #include <shadowmap_pars_vertex>

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
    vec4 worldPosition = modelMatrix * vec4(displaced, 1.0);
    vWorld = worldPosition.xyz;
    vReflection = textureMatrix * vec4(displaced, 1.0);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
    vec2 geometricGradient = result.yz + gradient * uRippleAmplitude;
    vec3 transformedNormal = mat3(viewMatrix) * normalize(vec3(-geometricGradient.x, 1.0, -geometricGradient.y));
    #include <shadowmap_vertex>
    #include <logdepthbuf_vertex>
  }
`;

const fragmentShader = `
  uniform sampler2D tDiffuse;
  uniform sampler2D tRefraction;
  uniform sampler2D tRefractionDepth;
  uniform mat4 uRefractionMatrix;
  uniform mat4 uInverseRefractionMatrix;
  uniform vec2 uRefractionTexel;
  uniform vec3 color;
  uniform float uTime;
  uniform float uAmplitude;
  uniform float uDepth;
  uniform vec3 uSunDirection;
  uniform bool receiveShadow;
  uniform vec2 uReflectionTexel;
  varying vec4 vReflection;
  varying vec3 vWorld;
  varying vec2 vGradient;
  #include <common>
  #include <packing>
  #include <logdepthbuf_pars_fragment>
  #include <shadowmap_pars_fragment>

  #if NUM_DIR_LIGHTS > 0
    struct DirectionalLight {
      vec3 direction;
      vec3 color;
    };
    uniform DirectionalLight directionalLights[NUM_DIR_LIGHTS];
  #endif

  ${waveFunction}
  vec3 directionalSunRadiance() {
    #if NUM_DIR_LIGHTS > 0
      // Three already applies the light's intensity and its lighting-mode
      // conversion here, matching the physical materials in the same scene.
      return directionalLights[0].color;
    #else
      return vec3(0.0);
    #endif
  }
  float directionalSunVisibility() {
    #if defined(USE_SHADOWMAP) && NUM_DIR_LIGHT_SHADOWS > 0
      if (receiveShadow) {
        DirectionalLightShadow sun = directionalLightShadows[0];
        return getShadow(directionalShadowMap[0], sun.shadowMapSize, sun.shadowBias, sun.shadowRadius, vDirectionalShadowCoord[0]);
      }
    #endif
    return 1.0;
  }
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
    vec2 p = point * 6.4;
    vec2 drift = vec2(uTime * 0.12, -uTime * 0.08);
    // Fade wavelengths smaller than a pixel instead of letting distant glints
    // flicker. These normals add millimeter detail without changing wave height.
    float footprint = max(length(dFdx(p)), length(dFdy(p)));
    vec2 fine = noiseGradient(p + drift) * 0.022 * (1.0 - smoothstep(0.3, 1.0, footprint));
    p = turn * p * 2.03 + vec2(17.1, 8.4);
    fine += inverseTurn * noiseGradient(p - drift * 1.37) * 0.010 * (1.0 - smoothstep(0.3, 1.0, footprint * 2.03));
    p = turn * p * 2.11 + vec2(3.8, 29.2);
    fine += inverseTurn * inverseTurn * noiseGradient(p + drift * 1.83) * 0.0045 * (1.0 - smoothstep(0.3, 1.0, footprint * 4.2833));
    return fine;
  }
  vec3 transmittedScene(vec3 view, vec3 normal) {
    vec4 surfaceClip = uRefractionMatrix * vec4(vWorld, 1.0);
    vec2 surfaceUv = surfaceClip.xy / surfaceClip.w * 0.5 + 0.5;
    // Trace through the known shallow layer using Snell's law. Both surfaces
    // share the camera capture but retain their own physical water depth.
    vec3 ray = refract(-view, normal, 1.0 / 1.333);
    vec3 floorPoint = vWorld + ray * (uDepth / max(-ray.y, 0.05));
    vec4 floorClip = uRefractionMatrix * vec4(floorPoint, 1.0);
    vec2 sampleUv = floorClip.xy / floorClip.w * 0.5 + 0.5;
    if (floorClip.w <= 0.0 || any(lessThan(sampleUv, uRefractionTexel)) || any(greaterThan(sampleUv, vec2(1.0) - uRefractionTexel))) {
      sampleUv = surfaceUv;
    }
    float depth = texture2D(tRefractionDepth, sampleUv).r;
    vec4 sampledWorld = uInverseRefractionMatrix * vec4(sampleUv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
    // A distorted sample cannot pull a foreground pedestal or arch down into
    // the water. Reconstructing world height avoids fixed camera clip planes.
    if (sampledWorld.y / sampledWorld.w > vWorld.y + 0.02) sampleUv = surfaceUv;
    return texture2D(tRefraction, clamp(sampleUv, uRefractionTexel, vec2(1.0) - uRefractionTexel)).rgb;
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
    // A fixed UV offset flattened the nearby reflections to almost a mirror.
    // Scale the wave response with distance, as in Three's planar water, so
    // foreground ripples break up highlights while distant arches stay calm.
    float distanceToEye = max(1.0, length(cameraPosition - vWorld));
    vec2 distortion = normal.xz * (0.001 + 1.0 / distanceToEye) * 6.0;
    vec2 sampleUv = clamp(projected + distortion, uReflectionTexel, vec2(1.0) - uReflectionTexel);
    // Three r143 writes ordinary render targets in linear encoding, regardless
    // of Reflector's texture.encoding label. Decode again and reflections darken.
    vec3 reflected = texture2D(tDiffuse, sampleUv).rgb;
    vec3 light = uSunDirection;
    vec3 halfDirection = normalize(light + view);
    float halfFacing = max(dot(normal, halfDirection), 0.0);
    float lightFacing = max(dot(normal, light), 0.0);
    // A tighter GGX lobe gives the sun small crisp glints. Normal variance
    // broadens only subpixel highlights, preserving stable light at distance.
    vec3 normalDx = dFdx(normal), normalDy = dFdy(normal);
    float normalVariance = 0.25 * (dot(normalDx, normalDx) + dot(normalDy, normalDy));
    float alphaSquared = clamp(0.000625 + normalVariance, 0.000625, 0.015);
    float denominator = halfFacing * halfFacing * (alphaSquared - 1.0) + 1.0;
    float distribution = alphaSquared / max(PI * denominator * denominator, 0.0000001);
    float sunFresnel = 0.02037 + 0.97963 * pow(1.0 - max(dot(view, halfDirection), 0.0), 5.0);
    float maskingView = lightFacing * sqrt(facing * facing * (1.0 - alphaSquared) + alphaSquared);
    float maskingLight = facing * sqrt(lightFacing * lightFacing * (1.0 - alphaSquared) + alphaSquared);
    float visibility = 0.5 / max(maskingView + maskingLight, 0.0001);
    float highlight = distribution * visibility * sunFresnel * lightFacing;
    // The aperture spotlight is a separate light. Its shadow must not erase
    // this directional sun's glints or multiply into the ambient floor light.
    float shadow = directionalSunVisibility();
    // Occlusion removes direct floor illumination and the sun lobe. Reflected
    // light comes from the captured scene and already contains its own shadows.
    float refractedCosine = sqrt(1.0 - (1.0 - facing * facing) / (1.333 * 1.333));
    float absorption = 1.0 - exp(-0.42 * uDepth / refractedCosine);
    vec3 shallow = color * mix(0.52, 1.0, shadow);
    vec3 surface = reflected * fresnel + shallow * ((1.0 - fresnel) * absorption);
    surface += transmittedScene(view, normal) * ((1.0 - fresnel) * (1.0 - absorption));
    surface += directionalSunRadiance() * highlight * shadow;
    // Resolve transmission here so Three's opaque pass includes finished water
    // when the crystal stations subsequently sample their transmission buffer.
    gl_FragColor = vec4(surface, 1.0);
    #include <encodings_fragment>
  }
`;

type Surface = { reflector: Reflector; material: ShaderMaterial; ripples: WaterRipples; bounds: Vector4; capture: Reflector["onBeforeRender"] };

function hasTransmission(material: Material | Material[]): boolean {
  if (Array.isArray(material)) return material.some(hasTransmission);
  return "transmission" in material && typeof material.transmission === "number" && material.transmission > 0;
}

/** Live geometry and scene reflections. Add group to the scene before rendering. */
export function createAtriumWater(options: { reflectionSize?: number; sunDirection?: Vector3 } = {}): AtriumWater {
  const group = new Group();
  group.name = "Hyper live reflective water";
  const requestedSize = options.reflectionSize ?? 1024;
  const maximumSize = Number.isFinite(requestedSize) ? Math.max(64, Math.min(1024, Math.round(requestedSize))) : 1024;
  const sunDirection = options.sunDirection?.clone() ?? new Vector3(-9, 11, -3);
  if (![sunDirection.x, sunDirection.y, sunDirection.z].every(Number.isFinite) || sunDirection.lengthSq() < 1e-8) sunDirection.set(-9, 11, -3);
  sunDirection.normalize();
  const surfaces: Surface[] = [];
  const refractionTarget = new WebGLRenderTarget(maximumSize, maximumSize, {
    type: HalfFloatType,
    minFilter: LinearFilter,
    magFilter: LinearFilter,
    generateMipmaps: false,
    depthBuffer: true,
    stencilBuffer: false,
  });
  refractionTarget.depthTexture = new DepthTexture(maximumSize, maximumSize, UnsignedIntType);
  const refractionMatrix = new Matrix4();
  const inverseRefractionMatrix = new Matrix4();
  const reflectionProjection = new Matrix4();
  const viewport = new Vector4();
  const captureMaterials = new Map<Material, { replacement: Material; release: () => void }>();
  const captureMaterialArrays = new WeakMap<Material[], Material[]>();
  const substitutedMeshes: Mesh[] = [];
  const originalMaterials: (Material | Material[])[] = [];
  let preparing = false;
  let paused = false;
  let disposed = false;
  let reflectionsReady = false;
  let nextReflection = 0;

  function captureMaterial(original: Material): Material {
    if (!hasTransmission(original)) return original;
    const cached = captureMaterials.get(original);
    if (cached) return cached.replacement;
    // Keep alpha/displacement maps, clipping, and shadow-side settings. The
    // renderer's separate depth material still casts the original silhouette.
    const replacement = original.clone();
    if ("transmission" in replacement) replacement.transmission = 0;
    replacement.colorWrite = false;
    replacement.depthWrite = false;
    const release = () => {
      original.removeEventListener("dispose", release);
      captureMaterials.delete(original);
      replacement.dispose();
    };
    captureMaterials.set(original, { replacement, release });
    original.addEventListener("dispose", release);
    return replacement;
  }

  function restoreMaterials() {
    for (let i = 0; i < substitutedMeshes.length; i++) substitutedMeshes[i].material = originalMaterials[i];
    substitutedMeshes.length = 0;
    originalMaterials.length = 0;
  }

  function addSurface(name: string, geometry: BufferGeometry, y: number, z: number, bounds: Vector4, amplitude: number, depth: number) {
    const ripples = createWaterRipples();
    const reflector = new Reflector(geometry, {
      textureWidth: maximumSize,
      textureHeight: maximumSize,
      clipBias: 0.003,
      multisample: 0,
      color: new Color(0xc2b5bc).convertSRGBToLinear(),
      shader: {
        uniforms: {
          ...UniformsLib.lights,
          color: { value: null }, tDiffuse: { value: null }, textureMatrix: { value: new Matrix4() },
          tRefraction: { value: null }, tRefractionDepth: { value: null },
          uRefractionMatrix: { value: new Matrix4() }, uInverseRefractionMatrix: { value: new Matrix4() },
          uRefractionTexel: { value: new Vector2(1 / maximumSize, 1 / maximumSize) },
          uTime: { value: 0 }, uAmplitude: { value: amplitude }, uRippleAmplitude: { value: amplitude * 0.07 },
          uDepth: { value: depth },
          uSunDirection: { value: sunDirection },
          uBounds: { value: bounds }, uRipples: { value: null },
          uRippleTexel: { value: new Vector2(1 / 128, 1 / 72) },
          uReflectionTexel: { value: new Vector2(1 / maximumSize, 1 / maximumSize) },
        },
        vertexShader,
        fragmentShader,
      },
    });
    // Preserve light intensity above display white until the final scene tone
    // mapping pass. The r143 Reflector otherwise allocates an 8-bit target.
    reflector.getRenderTarget().texture.type = HalfFloatType;
    reflector.name = name;
    reflector.rotation.x = -Math.PI / 2;
    reflector.position.set(0, y, z);
    reflector.frustumCulled = false;
    reflector.receiveShadow = true;
    reflector.renderOrder = -2;
    const material = reflector.material as ShaderMaterial;
    // Reflector clones texture uniforms, but both water surfaces must sample
    // the same live framebuffer attachments rather than independent clones.
    material.uniforms.tRefraction.value = refractionTarget.texture;
    material.uniforms.tRefractionDepth.value = refractionTarget.depthTexture;
    material.uniforms.uRipples.value = ripples.texture;
    material.toneMapped = false;
    material.lights = true;
    material.extensions.derivatives = true;
    material.transparent = false;
    material.depthWrite = true;
    const surface = { reflector, material, ripples, bounds, capture: reflector.onBeforeRender };
    // Captures happen once before the composer. The glass transmission pass
    // and the beauty pass then reuse them without nested reflection renders.
    reflector.onBeforeRender = () => {};
    surfaces.push(surface);
    group.add(reflector);
    return surface;
  }

  const flooded = addSurface("Water | flooded atrium", new PlaneGeometry(50, 63, 192, 240), 0.015, -3.5, new Vector4(-25, -35, 50, 63), 1.0, 0.435);
  const basin = addSurface("Water | central reflecting basin", new RingGeometry(0, 4.42, 128, 40), 0.61, 0, new Vector4(-4.42, -4.42, 8.84, 8.84), 0.68, 0.31);

  return {
    group,
    prepareFrame(renderer, scene, camera, forceReflections = true) {
      if (disposed || preparing) return;
      const target = renderer.getRenderTarget();
      const cubeFace = renderer.getActiveCubeFace();
      const mipLevel = renderer.getActiveMipmapLevel();
      const xrEnabled = renderer.xr.enabled;
      const shadowAutoUpdate = renderer.shadowMap.autoUpdate;
      const shadowNeedsUpdate = renderer.shadowMap.needsUpdate;
      const autoClear = renderer.autoClear;
      const scissorTest = renderer.getScissorTest();
      const wasVisible = group.visible;
      const refreshBoth = forceReflections || !reflectionsReady || !reflectionProjection.equals(camera.projectionMatrix);
      let completed = false;
      renderer.getCurrentViewport(viewport);
      preparing = true;
      try {
        // Explicit paused renders still need valid first-frame captures after
        // resize, station replacement, or a camera change.
        scene.updateMatrixWorld(true);
        camera.updateMatrixWorld();
        refractionMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
        inverseRefractionMatrix.copy(refractionMatrix).invert();
        renderer.xr.enabled = false;
        renderer.autoClear = true;
        group.visible = false;
        scene.traverseVisible(object => {
          if (object instanceof Mesh && hasTransmission(object.material)) {
            const original = object.material;
            substitutedMeshes.push(object);
            originalMaterials.push(original);
            if (Array.isArray(original)) {
              let replacements = captureMaterialArrays.get(original);
              if (!replacements) {
                replacements = [];
                captureMaterialArrays.set(original, replacements);
              }
              replacements.length = original.length;
              for (let i = 0; i < original.length; i++) replacements[i] = captureMaterial(original[i]);
              object.material = replacements;
            } else {
              object.material = captureMaterial(original);
            }
          }
        });
        renderer.setRenderTarget(refractionTarget);
        renderer.setScissorTest(false);
        renderer.state.buffers.depth.setMask(true);
        // Ordinary render initializes r143's private render state before its
        // shadow pass. Calling shadowMap.render directly cannot do that. Keep
        // the pearl visible to shadows while suppressing its color and depth.
        renderer.render(scene, camera);
        restoreMaterials();
        renderer.shadowMap.autoUpdate = false;
        renderer.shadowMap.needsUpdate = false;
        for (let index = 0; index < surfaces.length; index++) {
          const surface = surfaces[index];
          surface.material.uniforms.uRefractionMatrix.value.copy(refractionMatrix);
          surface.material.uniforms.uInverseRefractionMatrix.value.copy(inverseRefractionMatrix);
          // Refraction remains current for both surfaces. Their slow reflected
          // objects can share alternating captures during ordinary motion.
          if (!refreshBoth && index !== nextReflection) continue;
          const wasSurfaceVisible = surface.reflector.visible;
          try {
            surface.capture.call(surface.reflector, renderer, scene, camera, surface.reflector.geometry, surface.material, undefined as never);
          } finally {
            surface.reflector.visible = wasSurfaceVisible;
          }
        }
        reflectionProjection.copy(camera.projectionMatrix);
        reflectionsReady = true;
        nextReflection = refreshBoth ? 0 : (nextReflection + 1) % surfaces.length;
        completed = true;
      } finally {
        if (!completed) reflectionsReady = false;
        restoreMaterials();
        group.visible = wasVisible;
        renderer.xr.enabled = xrEnabled;
        renderer.shadowMap.autoUpdate = shadowAutoUpdate;
        renderer.shadowMap.needsUpdate = shadowNeedsUpdate;
        renderer.autoClear = autoClear;
        renderer.setRenderTarget(target, cubeFace, mipLevel);
        renderer.setScissorTest(scissorTest);
        renderer.state.setScissorTest(target?.scissorTest ?? scissorTest);
        renderer.state.viewport(viewport);
        preparing = false;
      }
    },
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
      reflectionsReady = false;
      const scale = Math.min(1, maximumSize / Math.max(width, height));
      const w = Math.max(32, Math.round(width * scale));
      const h = Math.max(32, Math.round(height * scale));
      refractionTarget.setSize(w, h);
      for (const surface of surfaces) {
        surface.reflector.getRenderTarget().setSize(w, h);
        surface.material.uniforms.uReflectionTexel.value.set(1 / w, 1 / h);
        surface.material.uniforms.uRefractionTexel.value.set(1 / w, 1 / h);
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      refractionTarget.dispose();
      for (const { release } of captureMaterials.values()) release();
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
