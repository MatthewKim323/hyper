import { AmbientLight, Box3, DirectionalLight, Fog, Group, HemisphereLight, LinearEncoding, Material, Mesh, MeshStandardMaterial, NoToneMapping, Object3D, PCFSoftShadowMap, PerspectiveCamera, Plane, PointLight, Raycaster, Scene, Texture, Vector2, Vector3, WebGLRenderer } from "three";
import { createAtriumGeometryLoader } from "./geometry-loader";
import { createAtriumAtmosphere } from "./atmosphere";
import { createAtriumWater } from "./water";
import { createAtriumSunlight } from "./sunlight";
import { createAtriumPipeline } from "./rendering";
import { createEtherealInteraction } from "./ethereal";
import { createAtriumSideLight, type AtriumSideLightMetadata } from "./side-light";
import { layoutAtriumStations } from "./layout";
import type { AtriumStation } from "./configuration";

export type AtriumManifest = {
  width: number; height: number;
  camera: { position: [number, number, number]; target: [number, number, number]; lens: number; sensorWidth: number };
  sunDirection?: [number, number, number];
  windows?: { position: [number, number, number]; width: number }[];
  sideLight?: AtriumSideLightMetadata;
  templates: { id: string; url: string; width?: number; height?: number; labelHeight?: number; labelSize?: number; arrowHeight?: number }[];
};
export type StationBounds = { station: AtriumStation; depth: number; left: number; top: number; width: number; height: number; labelLeft: number; labelTop: number; arrowTop: number; fontWidth: number };
export type AtriumRenderer = { setStations(stations: readonly AtriumStation[]): Promise<void>; setPaused(paused: boolean): void; setHover(id: string | null, x?: number, y?: number): void; setPressed(id: string | null): void; setPointer(x: number, y: number): void; dispose(): void };

export function isAtriumManifest(value: unknown): value is AtriumManifest {
  if (!value || typeof value !== "object") return false;
  const candidate = value as AtriumManifest;
  const triple = (vector: unknown) => Array.isArray(vector) && vector.length === 3 && vector.every(number => typeof number === "number" && Number.isFinite(number));
  return Number.isFinite(candidate.width) && candidate.width > 0 && Number.isFinite(candidate.height) && candidate.height > 0 && !!candidate.camera && triple(candidate.camera.position) && triple(candidate.camera.target) && candidate.camera.lens > 0 && candidate.camera.sensorWidth > 0 && Array.isArray(candidate.templates) && candidate.templates.length > 0 && candidate.templates.every(template => typeof template.id === "string" && typeof template.url === "string" && template.url.startsWith("/assets/hyper-atrium/") && template.url.endsWith(".glb"));
}

const fromBlender = ([x, y, z]: [number, number, number]) => new Vector3(x, z, -y);
const objectName = (object: Object3D) => String(object.userData.name ?? object.name).replaceAll("_", " ");

export async function createAtriumRenderer(canvas: HTMLCanvasElement, manifest: AtriumManifest, onBounds: (bounds: StationBounds[]) => void, signal?: AbortSignal): Promise<AtriumRenderer> {
  const renderer = new WebGLRenderer({ canvas, alpha: false, antialias: false, powerPreference: "high-performance" });
  // Keep scene and reflection passes linear; the composer owns the display transform.
  renderer.outputEncoding = LinearEncoding;
  renderer.toneMapping = NoToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.setPixelRatio(1);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFSoftShadowMap;
  const scene = new Scene();
  scene.fog = new Fog(0xe8d8d7, 38, 115);
  const ratio = manifest.width / manifest.height;
  const verticalFov = 2 * Math.atan(manifest.camera.sensorWidth / ratio / (2 * manifest.camera.lens)) * 180 / Math.PI;
  const camera = new PerspectiveCamera(verticalFov, ratio, 0.1, 250);
  const homePosition = fromBlender(manifest.camera.position);
  const homeTarget = fromBlender(manifest.camera.target);
  camera.position.copy(homePosition);
  camera.lookAt(homeTarget);
  camera.updateMatrixWorld();
  scene.add(new AmbientLight(0xffe9dd, .025), new HemisphereLight(0xf2ecff, 0x9f7769, .14));
  const sun = new DirectionalLight(0xffe6d5, 3.1);
  sun.target.position.set(1, 0, -3);
  sun.position.copy(manifest.sunDirection ? fromBlender(manifest.sunDirection).normalize().multiplyScalar(65).add(sun.target.position) : new Vector3(8, 13, -12));
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -36, right: 36, top: 38, bottom: -38, near: .5, far: 150 });
  sun.shadow.normalBias = .025;
  sun.shadow.bias = -.0002;
  sun.shadow.radius = 3;
  scene.add(sun, sun.target);
  const sunDirection = new Vector3().subVectors(sun.position, sun.target.position).normalize();
  const atmosphere = createAtriumAtmosphere(renderer, sunDirection);
  scene.add(atmosphere.sky);
  scene.environment = atmosphere.environment;
  const fill = new DirectionalLight(0xffd8c2, .28);
  fill.position.set(8, 5, 10);
  scene.add(fill);
  const rim = new DirectionalLight(0xffdccc, .4);
  rim.position.set(5, 9, -10);
  scene.add(rim);
  const pearlLight = new PointLight(0xffe9d1, .65, 6, 2);
  pearlLight.position.set(0, 1.7, -1.5);
  scene.add(pearlLight);
  const water = createAtriumWater({ reflectionSize: matchMedia("(pointer: coarse)").matches ? 512 : 1024, sunDirection });
  scene.add(water.group);
  const sunlight = createAtriumSunlight(sunDirection, manifest.windows);
  scene.add(sunlight.group);
  const sideLight = createAtriumSideLight(manifest.sideLight);
  scene.add(sideLight.group);
  const ethereal = createEtherealInteraction();
  scene.add(ethereal.group);
  const stationsGroup = new Group();
  scene.add(stationsGroup);
  const pipeline = createAtriumPipeline(renderer, scene, camera);
  const modelCache = new Map<string, Promise<Object3D>>();
  const retiredCovers: Object3D[] = [];
  const loader = createAtriumGeometryLoader();
  let room: Object3D | null = null;
  let disposed = false;
  let ready = false;
  let paused = false;
  let overlay = false;
  let frame = 0;
  let previous = 0;
  let elapsed = 0;
  let renderedFrames = 0;
  let generation = 0;
  const instanceMaterials = new Set<Material>();
  const sceneClock = { value: 0 };
  let hovered: string | null = null;
  let pressed: string | null = null;
  const hoverPointer = new Vector2();
  const roomPointer = new Vector2();
  const raycaster = new Raycaster();
  const poolPlane = new Plane(new Vector3(0, 1, 0), -.015);
  const basinPlane = new Plane(new Vector3(0, 1, 0), -.61);
  const poolHit = new Vector3();
  const basinHit = new Vector3();
  const lastSplash = new Vector3(999, 0, 999);
  type MovingObject = { object: Object3D; position: Vector3; rotation: Vector3; phase: number; amplitude: number };
  const floating: MovingObject[] = [];
  const orbit = new Group();
  orbit.position.set(0, 3.07, -1.5);
  scene.add(orbit);
  type Instance = { station: AtriumStation; model: Object3D; scale: number; labelHeight: number; labelSize: number; arrowHeight: number; icon: Group; restPosition: Vector3; hover: { value: number }; velocity: number; phase: number };
  let instances: Instance[] = [];

  function prepareRelic(model: Object3D, hover: { value: number }) {
    const icon = new Group();
    icon.name = "Floating ethereal relic";
    const iconParts: Mesh[] = [];
    model.traverse(object => {
      if (!(object instanceof Mesh)) return;
      if (!/plinth|light seam|title|enter/.test(objectName(object))) iconParts.push(object);
    });
    model.updateMatrixWorld(true);
    const relicBounds = new Box3();
    for (const part of iconParts) relicBounds.union(new Box3().setFromObject(part));
    const center = relicBounds.isEmpty() ? new Vector3(0, 2, 0) : model.worldToLocal(relicBounds.getCenter(new Vector3()));
    icon.position.copy(center);
    model.add(icon);
    model.updateMatrixWorld(true);
    iconParts.forEach(object => icon.attach(object));
    icon.traverse(object => {
      if (!(object instanceof Mesh)) return;
      const illuminate = (original: Material) => {
        const material = original.clone();
        instanceMaterials.add(material);
        if (material instanceof MeshStandardMaterial) {
          material.onBeforeCompile = shader => {
            shader.uniforms.uRelicHover = hover;
            shader.uniforms.uRelicTime = sceneClock;
            shader.vertexShader = "varying vec3 vRelicWorld;\n" + shader.vertexShader.replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\nvRelicWorld=(modelMatrix*vec4(transformed,1.)).xyz;");
            shader.fragmentShader = "varying vec3 vRelicWorld; uniform float uRelicHover; uniform float uRelicTime;\n" + shader.fragmentShader.replace("#include <output_fragment>", `
              float edge=pow(1.-abs(dot(normalize(normal),normalize(vViewPosition))),2.4);
              float shimmer=.94+.06*sin(uRelicTime*.7+vRelicWorld.x*.31);
              outgoingLight+=vec3(2.6,2.15,2.4)*shimmer*(.055+edge*(.8+uRelicHover*.65)+uRelicHover*.14);
              #include <output_fragment>
            `);
          };
          material.customProgramCacheKey = () => "hyper-floating-relic-v1";
        }
        return material;
      };
      object.material = Array.isArray(object.material) ? object.material.map(illuminate) : illuminate(object.material);
    });
    return { icon, restPosition: center.clone() };
  }

  function animateRelics(delta: number, still = false) {
    for (const instance of instances) {
      const target = instance.station.id === hovered ? 1 : 0;
      if (still) { instance.hover.value = target; instance.velocity = 0; }
      else {
        // The same mass1/stiffness100/damping10 spring drives interrupted hovers.
        const step = Math.min(delta, 0.05) / 3;
        for (let i = 0; i < 3; i++) {
          instance.velocity += (100 * (target - instance.hover.value) - 10 * instance.velocity) * step;
          instance.hover.value += instance.velocity * step;
        }
      }
      const hover = Math.max(0, Math.min(1.06, instance.hover.value));
      const movement = still ? 0 : 1;
      const settle = still ? 1 : 1 - Math.exp(-delta * 16);
      const idleTurn = movement * Math.sin(elapsed * .24 + instance.phase) * .06;
      instance.icon.rotation.x += ((target ? -hoverPointer.y * .045 * hover * movement : 0) - instance.icon.rotation.x) * settle;
      instance.icon.rotation.y += (idleTurn + (target ? hoverPointer.x * .085 * hover * movement : 0) - instance.icon.rotation.y) * settle;
      if (still) instance.icon.rotation.set(0, 0, 0);
      const pressScale = pressed === instance.station.id && !still ? .97 : 1;
      instance.icon.scale.setScalar(instance.icon.scale.x + (pressScale - instance.icon.scale.x) * (still ? 1 : 1 - Math.exp(-delta * 24)));
      instance.icon.position.y = instance.restPosition.y + movement * (Math.sin(elapsed * .65 + instance.phase) * .065 + hover * .11);

    }
  }

  function animateRoom(delta: number, still = false) {
    for (const item of floating) {
      item.object.position.y = item.position.y + (still ? 0 : Math.sin(elapsed * .65 + item.phase) * item.amplitude);
      item.object.rotation.y = item.rotation.y + (still ? 0 : Math.sin(elapsed * .17 + item.phase) * .1);
    }
    orbit.rotation.y = still ? 0 : Math.sin(elapsed * .23) * .14;
    orbit.rotation.z = still ? 0 : Math.sin(elapsed * .33) * .018;
    const damping = still ? 1 : 1 - Math.exp(-delta * 4);
    camera.position.x += (homePosition.x + (still ? 0 : roomPointer.x * .28) - camera.position.x) * damping;
    camera.position.y += (homePosition.y + (still ? 0 : -roomPointer.y * .08) - camera.position.y) * damping;
    camera.lookAt(homeTarget);
    camera.updateMatrixWorld();
    pearlLight.intensity = .65 + (still ? 0 : Math.sin(elapsed * .8) * .09);
  }

  function bounds() {
    if (disposed) return;
    onBounds(instances.map(({ station, model, scale, labelHeight, labelSize, arrowHeight }) => {
      const box = new Box3().setFromObject(model);
      const points = [];
      for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) points.push(new Vector3(x, y, z).project(camera));
      const left = Math.max(0, Math.min(...points.map(point => (point.x + 1) / 2)));
      const top = Math.max(0, Math.min(...points.map(point => (1 - point.y) / 2)));
      const right = Math.min(1, Math.max(...points.map(point => (point.x + 1) / 2)));
      const bottom = Math.min(1, Math.max(...points.map(point => (1 - point.y) / 2)));
      const label = new Vector3(model.position.x, labelHeight * scale, model.position.z + 0.15 * scale).project(camera);
      const arrow = new Vector3(model.position.x, arrowHeight * scale, model.position.z + 0.15 * scale).project(camera);
      const letter = new Vector3(model.position.x, (labelHeight + labelSize) * scale, model.position.z + 0.15 * scale).project(camera);
      const width = Math.max(0.001, right - left);
      const height = Math.max(0.001, bottom - top);
      return { station, depth: model.position.distanceTo(camera.position), left, top, width, height, labelLeft: ((label.x + 1) / 2 - left) / width, labelTop: ((1 - label.y) / 2 - top) / height, arrowTop: ((1 - arrow.y) / 2 - top) / height, fontWidth: Math.abs(letter.y - label.y) / 2 / ratio };
    }));
  }
  function render() {
    if (disposed || !ready) return;
    water.prepareFrame(renderer, scene, camera);
    // Refraction already refreshed complete-scene shadows for this frame.
    const autoUpdate = renderer.shadowMap.autoUpdate;
    const needsUpdate = renderer.shadowMap.needsUpdate;
    renderer.shadowMap.autoUpdate = false;
    renderer.shadowMap.needsUpdate = false;
    try { pipeline.render(); }
    finally {
      renderer.shadowMap.autoUpdate = autoUpdate;
      renderer.shadowMap.needsUpdate = needsUpdate;
    }
  }
  function resize() {
    const parent = canvas.parentElement;
    if (!parent || disposed) return;
    const width = Math.max(1, parent.clientWidth), height = Math.max(1, parent.clientHeight);
    const pixelCap = matchMedia("(pointer: coarse)").matches ? 1.25 : 1.75;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, pixelCap, Math.sqrt(3200000 / (width * height))));
    renderer.setSize(width, height, false);
    pipeline.resize(Math.max(1, parent.clientWidth), Math.max(1, parent.clientHeight));
    water.resize(parent.clientWidth, parent.clientHeight);
    bounds();
    render();
  }
  function draw(now: number) {
    if (disposed || !ready || paused || document.hidden || overlay) return;
    frame = requestAnimationFrame(draw);
    if (previous && now - previous < 1000 / 45) return;
    const delta = previous ? Math.min((now - previous) / 1000, 0.1) : 1 / 30;
    elapsed += delta;
    previous = now;
    sceneClock.value = elapsed;
    water.update(elapsed, delta);
    atmosphere.update(elapsed);
    sunlight.update(elapsed);
    sideLight.update(elapsed);
    ethereal.update(elapsed, delta);
    animateRelics(delta);
    animateRoom(delta);
    if (++renderedFrames % 4 === 0) bounds();
    if (renderedFrames % 30 === 0) canvas.dataset.frame = String(renderedFrames);
    render();
  }
  function resume() {
    cancelAnimationFrame(frame);
    previous = 0;
    if (!disposed && ready && !paused && !document.hidden && !overlay) frame = requestAnimationFrame(draw);
    else render();
  }
  function sectionChanged() {
    overlay = ["timeline", "benchmarks"].includes(document.body.dataset.workspaceSection ?? "overview");
    resume();
  }
  const observer = new ResizeObserver(resize);
  if (canvas.parentElement) observer.observe(canvas.parentElement);
  document.addEventListener("visibilitychange", resume);
  window.addEventListener("hyper:section-change", sectionChanged);

  function disposeModel(model: Object3D) {
    model.traverse(object => {
      if (!(object instanceof Mesh)) return;
      object.geometry.dispose();
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        for (const value of Object.values(material)) if (value instanceof Texture) value.dispose();
        material.dispose();
      }
    });
  }
  async function modelFor(templateId: string) {
    const template = manifest.templates.find(entry => entry.id === templateId) ?? manifest.templates.find(entry => entry.id === "crystal-clear") ?? manifest.templates[0];
    let pending = modelCache.get(template.id);
    if (!pending) {
      pending = loader.loadAsync(template.url).then(gltf => {
        if (disposed) { disposeModel(gltf.scene); throw new Error("Atrium unmounted"); }
        const covers: Object3D[] = [];
        gltf.scene.traverse(object => {
          if (!(object instanceof Mesh)) return;
          const name = objectName(object);
          // Compatibility with already-cached assets from before the cover removal.
          if (/solid clear arched|front polished rim/.test(name)) covers.push(object);
          if (/\| (title|enter)/i.test(name)) object.visible = false;
        });
        for (const cover of covers) { cover.removeFromParent(); retiredCovers.push(cover); }
        atmosphere.decorate(gltf.scene);
        return gltf.scene;
      });
      modelCache.set(template.id, pending);
    }
    return pending;
  }
  const api: AtriumRenderer = {
    async setStations(stations) {
      const update = ++generation;
      const placements = layoutAtriumStations(stations);
      const models = await Promise.all(placements.map(placement => modelFor(placement.station.template)));
      if (disposed || update !== generation) return;
      stationsGroup.clear();
      instanceMaterials.forEach(material => material.dispose());
      instanceMaterials.clear();
      instances = placements.map((placement, index) => {
        const model = models[index].clone(true);
        model.position.set(placement.x, 0, -placement.y);
        model.scale.multiplyScalar(placement.scale);
        stationsGroup.add(model);
        const hover = { value: 0 };
        const motion = prepareRelic(model, hover);
        const template = manifest.templates.find(template => template.id === placement.station.template);
        return { station: placement.station, model, scale: placement.scale, hover, velocity: 0, phase: index * 1.67, ...motion, labelHeight: template?.labelHeight ?? 1.42, labelSize: template?.labelSize ?? .21, arrowHeight: template?.arrowHeight ?? .86 };
      });
      scene.updateMatrixWorld(true);
      ethereal.setStations(instances.map(instance => {
        const template = manifest.templates.find(entry => entry.id === instance.station.template);
        const relic = new Box3().setFromObject(instance.icon);
        return { relicCenter: relic.getCenter(new Vector3()).sub(instance.model.position), relicSize: relic.getSize(new Vector3()), id: instance.station.id, position: instance.model.position.clone(), width: (template?.width ?? 2.2) * instance.scale, height: (template?.height ?? 4) * instance.scale, baseHeight: .48 * instance.scale };
      }));
      scene.updateMatrixWorld(true);
      bounds();
      render();
      const pearl = floating.find(item => /floating pearl marble sphere/.test(objectName(item.object)))?.object;
      atmosphere.captureRoomReflections(scene, pearl?.getWorldPosition(new Vector3()) ?? new Vector3(0, 3.16, -1.5), [water.group]);
      render();
      canvas.dataset.ready = "true";
    },
    setPaused(value) {
      paused = value;
      water.setPaused(value);
      ethereal.update(elapsed, 0, value);
      if (value) { animateRelics(0, true); animateRoom(0, true); bounds(); }
      resume();
    },
    setHover(id, x = 0, y = 0) {
      hovered = id;
      canvas.dataset.hoverStation = id ?? "";
      ethereal.setHover(id);
      hoverPointer.set(Math.max(-1, Math.min(1, x)), Math.max(-1, Math.min(1, y)));
      if (paused) { animateRelics(0, true); render(); }
    },
    setPressed(id) { pressed = id; if (paused) render(); },
    setPointer(x, y) {
      if (paused || !Number.isFinite(x) || !Number.isFinite(y)) return;
      roomPointer.set(Math.max(-1, Math.min(1, x)), Math.max(-1, Math.min(1, y)));
      raycaster.setFromCamera(new Vector2(x, -y), camera);
      const basin = raycaster.ray.intersectPlane(basinPlane, basinHit);
      const point = basin && basin.x * basin.x + basin.z * basin.z < 4.36 * 4.36 ? basin : raycaster.ray.intersectPlane(poolPlane, poolHit);
      if (!point || point.x < -25 || point.x > 25 || point.z < -35 || point.z > 28 || point.distanceToSquared(lastSplash) < .0225) return;
      // Avoid making ripples through the navigation relic or the stone rim.
      if (hovered || point.x * point.x + point.z * point.z >= 4.36 * 4.36 && point.x * point.x + point.z * point.z <= 4.95 * 4.95) return;
      water.splash(point.x, point.z, .28);
      lastSplash.copy(point);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      generation++;
      cancelAnimationFrame(frame);
      observer.disconnect();
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("hyper:section-change", sectionChanged);
      canvas.removeEventListener("webglcontextlost", api.dispose);
      signal?.removeEventListener("abort", api.dispose);
      canvas.dataset.ready = "false";
      instanceMaterials.forEach(material => material.dispose());
      modelCache.forEach(pending => { void pending.then(disposeModel).catch(() => {}); });
      retiredCovers.forEach(disposeModel);
      loader.dispose();
      if (room) disposeModel(room);
      orbit.traverse(object => { if (object instanceof Mesh) { object.geometry.dispose(); (Array.isArray(object.material) ? object.material : [object.material]).forEach(material => material.dispose()); } });
      sun.shadow.map?.dispose();
      atmosphere.dispose();
      water.dispose();
      sunlight.dispose();
      sideLight.dispose();
      ethereal.dispose();
      pipeline.dispose();
      renderer.dispose();
    },
  };
  canvas.addEventListener("webglcontextlost", api.dispose);
  signal?.addEventListener("abort", api.dispose, { once: true });
  if (signal?.aborted) { api.dispose(); return api; }
  try {
    const environment = await loader.loadAsync("/assets/hyper-atrium/environment.glb");
    if (disposed) { disposeModel(environment.scene); return api; }
    room = environment.scene;
    atmosphere.decorate(room);
    scene.add(room);
    const orbitParts: Object3D[] = [];
    room.traverse(object => {
      const name = objectName(object);
      if (/delicate orbital ring|suspended satellite/.test(name)) orbitParts.push(object);
      if (/floating pearl marble sphere|floating mineral|floating pearl light/.test(name)) {
        floating.push({ object, position: object.position.clone(), rotation: new Vector3(object.rotation.x, object.rotation.y, object.rotation.z), phase: /marble sphere|lower pole/.test(name) ? 0 : floating.length * 1.73, amplitude: /marble sphere|lower pole/.test(name) ? .1 : .12 });
      }
    });
    scene.updateMatrixWorld(true);
    orbitParts.forEach(object => orbit.attach(object));
    canvas.dataset.renderer = "live-3d";
    ready = true;
    resize();
    sectionChanged();
  } catch (error) { api.dispose(); throw error; }
  return api;
}
