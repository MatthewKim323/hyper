import { ACESFilmicToneMapping, AmbientLight, Box3, Color, DirectionalLight, Fog, Group, HemisphereLight, Material, Mesh, MeshPhysicalMaterial, MeshStandardMaterial, Object3D, PCFSoftShadowMap, PerspectiveCamera, Plane, PointLight, Raycaster, Scene, sRGBEncoding, Texture, Vector2, Vector3, WebGLRenderer } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { createAtriumAtmosphere } from "./atmosphere";
import { createAtriumWater } from "./water";
import { createAtriumSunlight } from "./sunlight";
import { createAtriumPipeline } from "./rendering";
import { layoutAtriumStations } from "./layout";
import type { AtriumStation } from "./configuration";

export type AtriumManifest = {
  width: number; height: number;
  camera: { position: [number, number, number]; target: [number, number, number]; lens: number; sensorWidth: number };
  templates: { id: string; url: string; width?: number; height?: number; labelHeight?: number }[];
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
  renderer.outputEncoding = sRGBEncoding;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = .83;
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
  scene.add(new AmbientLight(0xffe9dd, .12), new HemisphereLight(0xf2ecff, 0x9f7769, .35));
  const sun = new DirectionalLight(0xffe6d5, 2.4);
  sun.position.set(8, 13, -12);
  sun.target.position.set(1, 0, -3);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -22, right: 22, top: 18, bottom: -18, near: .5, far: 65 });
  sun.shadow.normalBias = .025;
  sun.shadow.bias = -.0002;
  sun.shadow.radius = 3;
  scene.add(sun, sun.target);
  const sunDirection = new Vector3().subVectors(sun.position, sun.target.position).normalize();
  const atmosphere = createAtriumAtmosphere(renderer, sunDirection);
  scene.add(atmosphere.sky);
  scene.environment = atmosphere.environment;
  const fill = new DirectionalLight(0xdedfff, .52);
  fill.position.set(8, 5, 10);
  scene.add(fill);
  const rim = new DirectionalLight(0xffdccc, .4);
  rim.position.set(5, 9, -10);
  scene.add(rim);
  const pearlLight = new PointLight(0xffe9d1, .65, 6, 2);
  pearlLight.position.set(0, 1.7, -1.5);
  scene.add(pearlLight);
  const water = createAtriumWater({ reflectionSize: 512, sunDirection });
  scene.add(water.group);
  const sunlight = createAtriumSunlight(sunDirection);
  scene.add(sunlight.group);
  const stationsGroup = new Group();
  scene.add(stationsGroup);
  const pipeline = createAtriumPipeline(renderer, scene, camera);
  const modelCache = new Map<string, Promise<Object3D>>();
  const loader = new GLTFLoader();
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
  type Instance = { station: AtriumStation; model: Object3D; scale: number; labelHeight: number; glass: Group; icon: Group; hover: { value: number }; velocity: number; phase: number };
  let instances: Instance[] = [];

  function prepareCrystal(model: Object3D, hover: { value: number }) {
    const glass = new Group(); glass.name = "Crystal optics motion";
    const icon = new Group(); icon.name = "Crystal icon motion";
    const opticalParts: Mesh[] = [];
    const iconParts: Mesh[] = [];
    model.traverse(object => {
      if (!(object instanceof Mesh)) return;
      const name = objectName(object);
      if (/solid clear arched|front polished rim/.test(name)) opticalParts.push(object);
      else if (!/plinth|light seam|title|enter/.test(name)) iconParts.push(object);
    });
    model.add(glass, icon);
    model.updateMatrixWorld(true);
    opticalParts.forEach(object => glass.attach(object));
    iconParts.forEach(object => icon.attach(object));
    glass.traverse(object => {
      if (!(object instanceof Mesh)) return;
      const polish = (original: Material) => {
        const material = original.clone();
        instanceMaterials.add(material);
        material.onBeforeCompile = shader => {
          shader.uniforms.uCrystalHover = hover;
          shader.uniforms.uCrystalTime = sceneClock;
          shader.vertexShader = "varying vec3 vCrystalWorld;\n" + shader.vertexShader.replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\nvCrystalWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;");
          shader.fragmentShader = "varying vec3 vCrystalWorld; uniform float uCrystalHover; uniform float uCrystalTime;\n" + shader.fragmentShader.replace("#include <output_fragment>", `
            float rim = pow(1.0 - abs(dot(normalize(normal), normalize(vViewPosition))), 2.8);
            float phase = vCrystalWorld.y * 1.4 + vCrystalWorld.x * 0.28 - uCrystalTime * 0.38;
            float caustic = pow(0.5 + 0.5 * sin(phase), 18.0);
            outgoingLight += vec3(1.0, 0.88, 0.78) * rim * (0.095 + uCrystalHover * 0.22 + caustic * 0.05);
            outgoingLight += vec3(1.0,.79,.66) * exp(-max(0.,vCrystalWorld.y-.48)*2.8) * .13;
            #include <output_fragment>
          `);
        };
        material.customProgramCacheKey = () => "hyper-crystal-fresnel-v1";
        return material;
      };
      object.material = Array.isArray(object.material) ? object.material.map(polish) : polish(object.material);
    });
    return { glass, icon };
  }

  function animateCrystals(delta: number, still = false) {
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
      instance.glass.rotation.x += ((target ? -hoverPointer.y * .012 * hover * movement : 0) - instance.glass.rotation.x) * settle;
      instance.glass.rotation.y += ((target ? hoverPointer.x * .025 * hover * movement : 0) - instance.glass.rotation.y) * settle;
      if (still) instance.glass.rotation.set(0, 0, 0);
      const pressScale = pressed === instance.station.id && !still ? .989 : 1;
      instance.glass.scale.setScalar(instance.glass.scale.x + (pressScale - instance.glass.scale.x) * (still ? 1 : 1 - Math.exp(-delta * 24)));
      instance.icon.position.y = movement * (Math.sin(elapsed * 0.65 + instance.phase) * 0.035 + hover * 0.065);
      instance.icon.rotation.y = movement * Math.sin(elapsed * 0.24 + instance.phase) * 0.028;

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
    onBounds(instances.map(({ station, model, scale, labelHeight }) => {
      const box = new Box3().setFromObject(model);
      const points = [];
      for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) points.push(new Vector3(x, y, z).project(camera));
      const left = Math.max(0, Math.min(...points.map(point => (point.x + 1) / 2)));
      const top = Math.max(0, Math.min(...points.map(point => (1 - point.y) / 2)));
      const right = Math.min(1, Math.max(...points.map(point => (point.x + 1) / 2)));
      const bottom = Math.min(1, Math.max(...points.map(point => (1 - point.y) / 2)));
      const label = new Vector3(model.position.x, labelHeight * scale, model.position.z + 0.15 * scale).project(camera);
      const arrow = new Vector3(model.position.x, 0.86 * scale, model.position.z + 0.15 * scale).project(camera);
      const letter = new Vector3(model.position.x, (labelHeight + 0.21) * scale, model.position.z + 0.15 * scale).project(camera);
      const width = Math.max(0.001, right - left);
      const height = Math.max(0.001, bottom - top);
      return { station, depth: model.position.distanceTo(camera.position), left, top, width, height, labelLeft: ((label.x + 1) / 2 - left) / width, labelTop: ((1 - label.y) / 2 - top) / height, arrowTop: ((1 - arrow.y) / 2 - top) / height, fontWidth: Math.abs(letter.y - label.y) / 2 / ratio };
    }));
  }
  function render() { if (!disposed && ready) pipeline.render(); }
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
    animateCrystals(delta);
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
        gltf.scene.traverse(object => {
          if (!(object instanceof Mesh)) return;
          if (/\| (title|enter)/i.test(objectName(object))) object.visible = false;
          const tune = (material: Material) => {
            if (material instanceof MeshPhysicalMaterial && (material.transmission > 0.7 || /optically clear/.test(material.name))) {
              material.transmission = 1;
              material.roughness = 0.065;
              material.ior = 1.43;
              material.thickness = 0.16;
              material.clearcoat = 0.5;
              material.envMapIntensity = 0.7;
              material.color = new Color(0xfff7f1);
            } else if (material instanceof MeshStandardMaterial) material.envMapIntensity = 0.8;
            return material;
          };
          object.material = Array.isArray(object.material) ? object.material.map(tune) : tune(object.material);
        });
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
        const motion = prepareCrystal(model, hover);
        return { station: placement.station, model, scale: placement.scale, hover, velocity: 0, phase: index * 1.67, ...motion, labelHeight: manifest.templates.find(template => template.id === placement.station.template)?.labelHeight ?? 1.42 };
      });
      scene.updateMatrixWorld(true);
      bounds();
      render();
      canvas.dataset.ready = "true";
    },
    setPaused(value) {
      paused = value;
      water.setPaused(value);
      if (value) { animateCrystals(0, true); animateRoom(0, true); bounds(); }
      resume();
    },
    setHover(id, x = 0, y = 0) {
      hovered = id;
      hoverPointer.set(Math.max(-1, Math.min(1, x)), Math.max(-1, Math.min(1, y)));
      if (paused) { animateCrystals(0, true); render(); }
    },
    setPressed(id) { pressed = id; if (paused) render(); },
    setPointer(x, y) {
      if (paused || !Number.isFinite(x) || !Number.isFinite(y)) return;
      roomPointer.set(Math.max(-1, Math.min(1, x)), Math.max(-1, Math.min(1, y)));
      raycaster.setFromCamera(new Vector2(x, -y), camera);
      const basin = raycaster.ray.intersectPlane(basinPlane, basinHit);
      const point = basin && basin.x * basin.x + basin.z * basin.z < 4.36 * 4.36 ? basin : raycaster.ray.intersectPlane(poolPlane, poolHit);
      if (!point || point.x < -25 || point.x > 25 || point.z < -35 || point.z > 28 || point.distanceToSquared(lastSplash) < .0225) return;
      // Avoid making ripples through the front face of a crystal or the stone rim.
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
      if (room) disposeModel(room);
      orbit.traverse(object => { if (object instanceof Mesh) { object.geometry.dispose(); (Array.isArray(object.material) ? object.material : [object.material]).forEach(material => material.dispose()); } });
      sun.shadow.map?.dispose();
      atmosphere.dispose();
      water.dispose();
      sunlight.dispose();
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
