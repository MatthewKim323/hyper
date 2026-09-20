import { AdditiveBlending, BufferGeometry, Float32BufferAttribute, Group, Mesh, Points, ShaderMaterial, Vector2, Vector3 } from "three";

export type EtherealStation = { id: string; position: Vector3; width: number; height: number; baseHeight: number };
export type EtherealInteraction = {
  group: Group;
  setStations(entries: EtherealStation[]): void;
  setHover(id: string | null): void;
  update(time: number, delta: number, paused?: boolean): void;
  dispose(): void;
};

const sparkleVertex = `
  attribute vec4 aSeed;
  uniform float uTime;
  uniform float uWeight;
  uniform float uWidth;
  uniform float uHeight;
  uniform float uBase;
  uniform float uPixels;
  varying float vOpacity;
  varying float vPrism;
  void main() {
    float progress = fract(aSeed.x + uTime * (0.045 + aSeed.y * 0.02));
    float body = uHeight - uBase;
    float radius = min(uWidth * 0.5, body * 0.48);
    float rise = progress * body;
    float cap = max(0.0, rise - (body - radius));
    float edge = sqrt(max(0.0, radius * radius - cap * cap));
    float side = aSeed.z < 0.5 ? -1.0 : 1.0;
    vec3 point = vec3(side * (edge + uWidth * 0.005), uBase + rise, (0.115 + aSeed.w * 0.028) * uBase / 0.48);
    vec4 view = modelViewMatrix * vec4(point, 1.0);
    gl_Position = projectionMatrix * view;
    float perspectiveSize = uPixels * projectionMatrix[1][1] * 0.010 / max(0.1, -view.z);
    gl_PointSize = clamp(perspectiveSize * (0.7 + aSeed.w * 0.65), 1.0, 3.2);
    float life = smoothstep(0.0, 0.14, progress) * (1.0 - smoothstep(0.78, 1.0, progress));
    float shimmer = 0.68 + 0.32 * sin(uTime * 0.7 + aSeed.w * 6.2831853);
    vOpacity = uWeight * life * shimmer * step(0.45, aSeed.y);
    vPrism = aSeed.w;
  }
`;

const sparkleFragment = `
  varying float vOpacity;
  varying float vPrism;
  void main() {
    vec2 p = gl_PointCoord - 0.5;
    float radius = length(p);
    float core = exp(-radius * radius * 27.0);
    float halo = exp(-radius * radius * 9.0) * 0.12;
    float edge = 1.0 - smoothstep(0.37, 0.5, radius);
    vec3 warm = vec3(1.25, 1.07, 0.86);
    vec3 prism = mix(vec3(1.08, 0.91, 1.13), vec3(0.88, 1.09, 1.24), vPrism);
    gl_FragColor = vec4(mix(warm, prism, 0.28), (core + halo) * edge * vOpacity * 0.54);
    #include <encodings_fragment>
  }
`;

const arcVertex = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const arcFragment = `
  uniform float uTime;
  uniform float uWeight;
  varying vec2 vUv;
  void main() {
    float endFade = smoothstep(0.0, 0.18, vUv.x) * (1.0 - smoothstep(0.82, 1.0, vUv.x));
    float rim = pow(max(0.0, 1.0 - abs(vUv.y * 2.0 - 1.0)), 0.45);
    float drift = 0.88 + 0.12 * cos(vUv.x * 6.2831853 - uTime * 0.24);
    gl_FragColor = vec4(1.12, 0.96, 0.81, endFade * rim * drift * uWeight * 0.30);
    #include <encodings_fragment>
  }
`;

function createSparkleGeometry() {
  const count = 32;
  const geometry = new BufferGeometry();
  const seeds = new Float32Array(count * 4);
  let seed = 190926;
  for (let i = 0; i < seeds.length; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    seeds[i] = seed / 4294967296;
  }
  geometry.setAttribute("position", new Float32BufferAttribute(new Float32Array(count * 3), 3));
  geometry.setAttribute("aSeed", new Float32BufferAttribute(seeds, 4));
  return geometry;
}

function createArcGeometry() {
  const segments = 64;
  const vertices = new Float32Array((segments + 1) * 2 * 3);
  const uv = new Float32Array((segments + 1) * 2 * 2);
  const indices: number[] = [];
  for (let i = 0; i <= segments; i++) {
    const progress = i / segments;
    const angle = Math.PI * (0.08 + progress * 0.84);
    for (let side = 0; side < 2; side++) {
      const index = i * 2 + side;
      const radius = 1 + (side - 0.5) * 0.012;
      vertices[index * 3] = Math.cos(angle) * radius;
      vertices[index * 3 + 2] = Math.sin(angle) * radius;
      uv[index * 2] = progress;
      uv[index * 2 + 1] = side;
    }
    if (i < segments) {
      const start = i * 2;
      indices.push(start, start + 2, start + 1, start + 1, start + 2, start + 3);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(vertices, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(uv, 2));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
}

type Accent = {
  group: Group;
  sparks: Points;
  arc: Mesh;
  sparkMaterial: ShaderMaterial;
  arcMaterial: ShaderMaterial;
  weight: number;
};

/** Actual depth-tested geometry, with no decorative layer over the canvas. */
export function createEtherealInteraction(): EtherealInteraction {
  const group = new Group();
  group.name = "Hyper | restrained crystal hover glints";
  const sparkleGeometry = createSparkleGeometry();
  const arcGeometry = createArcGeometry();
  const stations = new Map<string, Accent>();
  const drawingSize = new Vector2();
  let hovered: string | null = null;
  let paused = false;
  let elapsed = 0;
  let disposed = false;

  function makeAccent(): Accent {
    const stationGroup = new Group();
    const sparkMaterial = new ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uWeight: { value: 0 }, uWidth: { value: 2 }, uHeight: { value: 4 }, uBase: { value: 0.46 }, uPixels: { value: 800 } },
      vertexShader: sparkleVertex, fragmentShader: sparkleFragment,
      transparent: true, depthTest: true, depthWrite: false, blending: AdditiveBlending, toneMapped: false,
    });
    const arcMaterial = new ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uWeight: { value: 0 } },
      vertexShader: arcVertex, fragmentShader: arcFragment,
      transparent: true, depthTest: true, depthWrite: false, blending: AdditiveBlending, toneMapped: false,
    });
    const sparks = new Points(sparkleGeometry, sparkMaterial);
    sparks.name = "Fine rising edge glints";
    sparks.frustumCulled = false;
    sparks.onBeforeRender = renderer => {
      const target = renderer.getRenderTarget();
      sparkMaterial.uniforms.uPixels.value = target?.height ?? renderer.getDrawingBufferSize(drawingSize).y;
    };
    const arc = new Mesh(arcGeometry, arcMaterial);
    arc.name = "Inset warm front arc";
    stationGroup.add(sparks, arc);
    stationGroup.visible = false;
    group.add(stationGroup);
    return { group: stationGroup, sparks, arc, sparkMaterial, arcMaterial, weight: 0 };
  }

  function syncAccent(accent: Accent, target: number, delta: number) {
    if (paused) accent.weight = target;
    else accent.weight += (target - accent.weight) * (1 - Math.exp(-delta * (target > accent.weight ? 11 : 7)));
    if (accent.weight < 0.001 && target === 0) accent.weight = 0;
    accent.group.visible = accent.weight > 0;
    accent.sparkMaterial.uniforms.uWeight.value = accent.weight;
    accent.arcMaterial.uniforms.uWeight.value = accent.weight;
    accent.sparkMaterial.uniforms.uTime.value = elapsed;
    accent.arcMaterial.uniforms.uTime.value = elapsed;
  }

  return {
    group,
    setStations(entries) {
      if (disposed) return;
      const present = new Set<string>();
      for (const entry of entries) {
        if (!entry.id || present.has(entry.id) || !Number.isFinite(entry.width) || !Number.isFinite(entry.height) || entry.width <= 0 || entry.height <= 0 || ![entry.position.x, entry.position.y, entry.position.z].every(Number.isFinite)) continue;
        present.add(entry.id);
        const accent = stations.get(entry.id) ?? makeAccent();
        stations.set(entry.id, accent);
        accent.group.name = "Hover accents | " + entry.id;
        accent.group.position.copy(entry.position);
        const base = entry.baseHeight;
        accent.sparkMaterial.uniforms.uWidth.value = entry.width;
        accent.sparkMaterial.uniforms.uHeight.value = entry.height;
        accent.sparkMaterial.uniforms.uBase.value = base;
        accent.arc.position.y = base + 0.01;
        accent.arc.scale.setScalar(entry.width * 0.57);
        syncAccent(accent, entry.id === hovered ? 1 : 0, 0);
      }
      for (const [id, accent] of stations) {
        if (present.has(id)) continue;
        accent.sparkMaterial.dispose();
        accent.arcMaterial.dispose();
        accent.group.removeFromParent();
        stations.delete(id);
      }
      if (hovered && !present.has(hovered)) hovered = null;
    },
    setHover(id) {
      if (disposed) return;
      hovered = id;
      if (paused) for (const [stationId, accent] of stations) syncAccent(accent, stationId === hovered ? 1 : 0, 0);
    },
    update(time, delta, reducedMotion = false) {
      if (disposed) return;
      paused = reducedMotion;
      if (!paused && Number.isFinite(time)) elapsed = time;
      const step = Number.isFinite(delta) ? Math.max(0, Math.min(delta, 0.1)) : 0;
      for (const [id, accent] of stations) syncAccent(accent, id === hovered ? 1 : 0, step);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const accent of stations.values()) {
        accent.sparkMaterial.dispose();
        accent.arcMaterial.dispose();
      }
      stations.clear();
      sparkleGeometry.dispose();
      arcGeometry.dispose();
      group.clear();
      group.removeFromParent();
    },
  };
}
