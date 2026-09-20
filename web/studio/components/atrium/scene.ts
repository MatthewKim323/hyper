import { AmbientLight, Box3, Color, DirectionalLight, Fog, Group, HemisphereLight, LinearEncoding, Material, Mesh, MeshStandardMaterial, NoToneMapping, Object3D, PCFSoftShadowMap, PerspectiveCamera, Plane, PointLight, Raycaster, Scene, Texture, Vector2, Vector3, WebGLRenderer } from "three";
import { createAtriumGeometryLoader } from "./geometry-loader";
import { createAtriumAtmosphere } from "./atmosphere";
import { createAtriumWater } from "./water";
import { createAtriumSunlight } from "./sunlight";
import { createAtriumPipeline } from "./rendering";
import { createEtherealInteraction } from "./ethereal";
import { createAtriumSideLight, type AtriumSideLightMetadata } from "./side-light";
import { createAgentAura, type AgentAura } from "./agent-aura";
import { getWorldVoiceVisual, subscribeWorldVoice } from "@/lib/command/world-voice";
import { configureAtriumTransmission } from "./transmission";
import { createAtriumGpuProfile } from "./gpu-profile";
import { layoutAtriumStations } from "./layout";
import { createFocusRig } from "./focus";
import { createRelicParts } from "./relic-parts";
import { createRelicInterior } from "./relic-interior";
import type { AtriumStation } from "./configuration";
import type { RelicMotionState } from "./RelicExperience";

export type AtriumManifest = {
  width: number; height: number;
  camera: { position: [number, number, number]; target: [number, number, number]; lens: number; sensorWidth: number };
  sunDirection?: [number, number, number];
  windows?: { position: [number, number, number]; width: number }[];
  sideLight?: AtriumSideLightMetadata;
  pearlLight?: { position: [number, number, number]; colorLinear: [number, number, number]; blenderEnergy: number; radius: number };
  templates: { id: string; url: string; width?: number; height?: number; labelHeight?: number; labelSize?: number; arrowHeight?: number }[];
};
export type StationBounds = { station: AtriumStation; depth: number; left: number; top: number; width: number; height: number; labelLeft: number; labelTop: number; arrowTop: number; fontWidth: number };
/** Where the focused relic and its orbit slots land on the frame, 0 to 1, plus how far the camera has committed. */
export type FocusFrame = { progress: number; center: { x: number; y: number }; slots: { x: number; y: number }[]; reach: number };
export type AgentBounds = { left: number; top: number; width: number; height: number };
export type AtriumRenderer = { setStations(stations: readonly AtriumStation[]): Promise<void>; setPaused(paused: boolean): void; setHover(id: string | null, x?: number, y?: number): void; setPressed(id: string | null): void; setPointer(x: number, y: number): void; setRelicMotion(id: string | null, state: RelicMotionState): void; /** Fly in on one relic, or home with null. `visibleShare` is how much of the frame width is on screen. */ setFocus(id: string | null, visibleShare?: number): void; /** Called every frame while a relic is in focus or the camera is still returning. */ setFocusListener(listener: ((frame: FocusFrame) => void) | null): void; dispose(): void };

export function isAtriumManifest(value: unknown): value is AtriumManifest {
  if (!value || typeof value !== "object") return false;
  const candidate = value as AtriumManifest;
  const triple = (vector: unknown) => Array.isArray(vector) && vector.length === 3 && vector.every(number => typeof number === "number" && Number.isFinite(number));
  return Number.isFinite(candidate.width) && candidate.width > 0 && Number.isFinite(candidate.height) && candidate.height > 0 && !!candidate.camera && triple(candidate.camera.position) && triple(candidate.camera.target) && candidate.camera.lens > 0 && candidate.camera.sensorWidth > 0 && Array.isArray(candidate.templates) && candidate.templates.length > 0 && candidate.templates.every(template => typeof template.id === "string" && typeof template.url === "string" && template.url.startsWith("/assets/hyper-atrium/") && template.url.endsWith(".glb"));
}

// Orbit slots around a focused relic, in relic half-heights along camera right and up. The right side
// of the frame belongs to the panel, so cards gather left, above and below.
const ORBIT_SLOTS: [number, number][] = [[-1.05, 1.62], [-1.2, -1.58], [1.0, 1.7], [.95, -1.66]];
const fromBlender = ([x, y, z]: [number, number, number]) => new Vector3(x, z, -y);
const objectName = (object: Object3D) => String(object.userData.name ?? object.name).replaceAll("_", " ");

export async function createAtriumRenderer(canvas: HTMLCanvasElement, manifest: AtriumManifest, onBounds: (bounds: StationBounds[]) => void, signal?: AbortSignal, onAgentBounds?: (bounds: AgentBounds) => void): Promise<AtriumRenderer> {
  const renderer = new WebGLRenderer({ canvas, alpha: false, antialias: false, powerPreference: "high-performance" });
  const restoreTransmission = configureAtriumTransmission(renderer, matchMedia("(pointer: coarse)").matches ? 512 : 1024);
  // Metal timer queries split command buffers and disturb normal frame pacing.
  // Keep profiling explicit, even in development, when measuring a GPU phase.
  const gpuProfile = createAtriumGpuProfile(renderer, process.env.NODE_ENV === "development" && new URLSearchParams(window.location.search).get("gpuProfile") === "1");
  if (process.env.NODE_ENV === "development") {
    renderer.info.autoReset = false;
    const gl = renderer.getContext();
    const debug = gl.getExtension("WEBGL_debug_renderer_info");
    canvas.dataset.gpu = String(gl.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
  }
  // Keep scene and reflection passes linear; the composer owns the display transform.
  renderer.outputEncoding = LinearEncoding;
  renderer.toneMapping = NoToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.setPixelRatio(1);
  // Adaptive resolution state, declared before anything that can call resize().
  let quality = 1;
  let steadySamples = 0;
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
  const focusRig = createFocusRig(camera, homePosition, homeTarget);
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
  // Match the authored soft inner source. Three's legacy point intensity uses
  // a separate calibration from Cycles watts and cannot model source radius.
  const pearlGlow = .65 * (manifest.pearlLight?.blenderEnergy ?? 6) / 24;
  const pearlColor = manifest.pearlLight ? new Color().setRGB(...manifest.pearlLight.colorLinear) : new Color(0xffe9d1);
  const pearlLight = new PointLight(pearlColor, pearlGlow, 6, 2);
  pearlLight.position.copy(manifest.pearlLight ? fromBlender(manifest.pearlLight.position) : new Vector3(0, 2.3311, -1.5));
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
  const pipeline = createAtriumPipeline(renderer, scene, camera, gpuProfile);
  const interior = createRelicInterior(ratio);
  let interiorAmount = 0;
  let interiorSection = false;
  const modelCache = new Map<string, Promise<Object3D>>();
  const retiredCovers: Object3D[] = [];
  const loader = createAtriumGeometryLoader();
  let room: Object3D | null = null;
  let agentPearl: Mesh | null = null;
  let agentAura: AgentAura | null = null;
  let disposed = false;
  let ready = false;
  let paused = false;
  let overlay = false;
  let frame = 0;
  let previous = 0;
  let elapsed = 0;
  let renderedFrames = 0;
  let frameSampleStarted = 0;
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
  type Instance = { station: AtriumStation; model: Object3D; scale: number; labelHeight: number; labelSize: number; arrowHeight: number; icon: Group; restPosition: Vector3; restBounds: Box3; parts: ReturnType<typeof createRelicParts>; hover: { value: number }; activity: { value: number }; velocity: number; phase: number; motion: RelicMotionState };
  let instances: Instance[] = [];
  let focusedStation: string | null = null;
  let focusShare = 1;
  let focusListener: ((frame: FocusFrame) => void) | null = null;
  let focusSubject: { center: Vector3; reach: number } | null = null;
  let lastFocusProgress = 0;

  function prepareRelic(model: Object3D, hover: { value: number }, template: string) {
    const activity = { value: 0 };
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
            shader.uniforms.uRelicBusy = activity;
            shader.vertexShader = "varying vec3 vRelicWorld;\n" + shader.vertexShader.replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\nvRelicWorld=(modelMatrix*vec4(transformed,1.)).xyz;");
            shader.fragmentShader = "varying vec3 vRelicWorld; uniform float uRelicHover; uniform float uRelicTime; uniform float uRelicBusy;\n" + shader.fragmentShader.replace("#include <output_fragment>", `
              float edge=pow(1.-abs(dot(normalize(normal),normalize(vViewPosition))),2.4);
              float shimmer=.94+.06*sin(uRelicTime*.7+vRelicWorld.x*.31);
              outgoingLight+=vec3(2.6,2.15,2.4)*shimmer*(.055+edge*(.8+uRelicHover*.65)+uRelicHover*.14);
              float ribbon=pow(max(0.,sin(vRelicWorld.y*3.6-uRelicTime*2.1)),28.);
              outgoingLight+=vec3(1.,.75,.51)*ribbon*uRelicBusy*.28;
              #include <output_fragment>
            `);
          };
          material.customProgramCacheKey = () => "hyper-floating-relic-v2";
        }
        return material;
      };
      object.material = Array.isArray(object.material) ? object.material.map(illuminate) : illuminate(object.material);
    });
    return { icon, activity, restPosition: center.clone(), restBounds: new Box3().setFromObject(icon), parts: createRelicParts(icon, template) };
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
      instance.activity.value = still ? 0 : instance.motion.busy ? 1 : 0;
      // The relic opens as the camera commits to it, and hints at it on hover.
      instance.parts.update(instance.station.id === focusedStation ? 1 : 0, delta, elapsed, still, { ...instance.motion, hover });
      const movement = still ? 0 : 1 - instance.parts.open;
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
    focusRig.update(delta, roomPointer, still);
    canvas.dataset.focusProgress = focusRig.progress.toFixed(3);
    const threshold = Math.max(0, Math.min(1, (focusRig.progress - .35) / .6));
    interiorAmount = interiorSection ? threshold * threshold * (3 - 2 * threshold) : 0;
    interior.update(elapsed, interiorAmount, still, roomPointer, focusShare);
    pipeline.setInterior(interior, interiorAmount, still ? 0 : elapsed);
    canvas.dataset.interiorProgress = interiorAmount.toFixed(3);
    if (focusListener && focusSubject && (focusRig.focused || focusRig.progress > .002 || lastFocusProgress !== 0)) {
      // Orbit slots sit on the camera-facing plane through the relic, so cards hug it at any angle.
      const right = new Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
      const up = new Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
      const project = (point: Vector3) => { point.project(camera); return { x: (point.x + 1) / 2, y: (1 - point.y) / 2 }; };
      const center = project(focusSubject.center.clone());
      const edge = project(focusSubject.center.clone().addScaledVector(up, focusSubject.reach));
      focusListener({
        progress: focusRig.progress,
        center,
        reach: Math.abs(edge.y - center.y),
        slots: ORBIT_SLOTS.map(([x, y]) => project(focusSubject!.center.clone().addScaledVector(right, x * focusSubject!.reach).addScaledVector(up, y * focusSubject!.reach))),
      });
      lastFocusProgress = focusRig.progress;
    }
    pearlLight.intensity = pearlGlow * (1 + (still ? 0 : Math.sin(elapsed * .8) * .12));
  }

  function bounds() {
    if (disposed) return;
    if (agentPearl && onAgentBounds) {
      const box = new Box3().setFromObject(agentPearl);
      const points: Vector3[] = [];
      for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) points.push(new Vector3(x, y, z).project(camera));
      const left = Math.min(...points.map(point => (point.x + 1) / 2));
      const top = Math.min(...points.map(point => (1 - point.y) / 2));
      onAgentBounds({ left, top, width: Math.max(...points.map(point => (point.x + 1) / 2)) - left, height: Math.max(...points.map(point => (1 - point.y) / 2)) - top });
    }
    onBounds(instances.map(({ station, model, icon, scale, labelHeight, labelSize, arrowHeight }) => {
      // Pedestals overlap in projection. Their broad geometry must never steal a neighboring
      // relic's clicks: target the floating object plus its own label and arrow instead.
      const box = new Box3().setFromObject(icon);
      const points = [];
      for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) points.push(new Vector3(x, y, z).project(camera));
      const label = new Vector3(model.position.x, labelHeight * scale, model.position.z + 0.15 * scale).project(camera);
      const arrow = new Vector3(model.position.x, arrowHeight * scale, model.position.z + 0.15 * scale).project(camera);
      const letter = new Vector3(model.position.x, (labelHeight + labelSize) * scale, model.position.z + 0.15 * scale).project(camera);
      const fontWidth = Math.abs(letter.y - label.y) / 2 / ratio;
      const font = Math.max(fontWidth, 11 / Math.max(1, canvas.parentElement?.clientWidth ?? 1280));
      const lineLength = station.label === "Accounts Payable" ? 8 : Math.min(20, station.label.length);
      const textHalf = Math.max(font * lineLength * .32, font * 1.15);
      const labelX = (label.x + 1) / 2, labelY = (1 - label.y) / 2, arrowY = (1 - arrow.y) / 2;
      const left = Math.max(0, Math.min(labelX - textHalf, ...points.map(point => (point.x + 1) / 2)));
      const top = Math.max(0, Math.min(labelY - font * ratio, ...points.map(point => (1 - point.y) / 2)));
      const right = Math.min(1, Math.max(labelX + textHalf, ...points.map(point => (point.x + 1) / 2)));
      const bottom = Math.min(1, Math.max(arrowY + font * ratio * 1.05, ...points.map(point => (1 - point.y) / 2)));
      const width = Math.max(0.001, right - left);
      const height = Math.max(0.001, bottom - top);
      return { station, depth: model.position.distanceTo(camera.position), left, top, width, height, labelLeft: (labelX - left) / width, labelTop: (labelY - top) / height, arrowTop: (arrowY - top) / height, fontWidth };
    }));
  }
  function render(forceReflections = true) {
    if (disposed || !ready) return;
    gpuProfile.beginFrame();
    const captureStarted = process.env.NODE_ENV === "development" ? performance.now() : 0;
    if (process.env.NODE_ENV === "development") renderer.info.reset();
    if (interiorAmount < .999) gpuProfile.measure("capture", () => water.prepareFrame(renderer, scene, camera, forceReflections));
    const beautyStarted = process.env.NODE_ENV === "development" ? performance.now() : 0;
    // Refraction already refreshed complete-scene shadows for this frame.
    const autoUpdate = renderer.shadowMap.autoUpdate;
    const needsUpdate = renderer.shadowMap.needsUpdate;
    renderer.shadowMap.autoUpdate = false;
    renderer.shadowMap.needsUpdate = false;
    try {
      pipeline.render();
      gpuProfile.measure("calibration", () => {});
      if (process.env.NODE_ENV === "development") {
        const gpuTiming = gpuProfile.poll();
        canvas.dataset.gpuTimer = String(gpuProfile.supported);
        canvas.dataset.captureGpuMs = gpuTiming.captureMs?.toFixed(1) ?? "";
        canvas.dataset.beautyGpuMs = gpuTiming.beautyMs?.toFixed(1) ?? "";
        canvas.dataset.bloomGpuMs = gpuTiming.bloomMs?.toFixed(1) ?? "";
        canvas.dataset.toneGpuMs = gpuTiming.toneMs?.toFixed(1) ?? "";
        canvas.dataset.displayGpuMs = gpuTiming.displayMs?.toFixed(1) ?? "";
        canvas.dataset.calibrationGpuMs = gpuTiming.calibrationMs?.toFixed(1) ?? "";
        canvas.dataset.gpuSamples = String(gpuTiming.calibrationSamples);
        canvas.dataset.gpuPending = String(gpuTiming.pending);
        canvas.dataset.gpuSkipped = String(gpuTiming.skipped);
        canvas.dataset.drawCalls = String(renderer.info.render.calls);
        canvas.dataset.triangles = String(renderer.info.render.triangles);
        canvas.dataset.captureMs = (beautyStarted - captureStarted).toFixed(1);
        canvas.dataset.beautyMs = (performance.now() - beautyStarted).toFixed(1);
      }
    }
    finally {
      renderer.shadowMap.autoUpdate = autoUpdate;
      renderer.shadowMap.needsUpdate = needsUpdate;
    }
  }
  function resize() {
    const parent = canvas.parentElement;
    if (!parent || disposed) return;
    const width = Math.max(1, parent.clientWidth), height = Math.max(1, parent.clientHeight);
    const pixelCap = matchMedia("(pointer: coarse)").matches ? 1.25 : 1.5;
    // `quality` is lowered by the frame loop when the measured rate drops, and raised again when there is headroom.
    renderer.setPixelRatio(Math.max(.6, Math.min(window.devicePixelRatio || 1, pixelCap, Math.sqrt(2600000 / (width * height))) * quality));
    renderer.setSize(width, height, false);
    pipeline.resize(Math.max(1, parent.clientWidth), Math.max(1, parent.clientHeight));
    water.resize(parent.clientWidth, parent.clientHeight);
    if (focusedStation) api.setFocus(focusedStation, Math.min(1, window.innerWidth / width));
    bounds();
    render();
  }
  function draw(now: number) {
    if (disposed || !ready || paused || document.hidden || overlay) return;
    frame = requestAnimationFrame(draw);
    if (previous && now - previous < 1000 / 60 - .5) return;
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
    const voice = getWorldVoiceVisual();
    agentAura?.update(elapsed, delta, voice);
    if (++renderedFrames % 4 === 0) bounds();
    if (renderedFrames % 30 === 0) {
      canvas.dataset.frame = String(renderedFrames);
      canvas.dataset.agentState = voice.state;
      canvas.dataset.agentLevel = voice.level.toFixed(3);
      if (frameSampleStarted) {
        const fps = 30000 / (now - frameSampleStarted);
        canvas.dataset.fps = fps.toFixed(1);
        // Adaptive resolution: this scene is fill-rate bound (half-float beauty, bloom, captures), so
        // pixels are the cheapest thing to give up. Step down fast, step up slowly, never oscillate
        // on a single sample.
        const next = fps < 42 ? Math.max(.6, quality - .12) : fps > 57 && ++steadySamples >= 4 ? Math.min(1, quality + .06) : quality;
        if (fps <= 57) steadySamples = 0;
        if (next !== quality) { quality = next; steadySamples = 0; canvas.dataset.quality = quality.toFixed(2); resize(); }
      }
      frameSampleStarted = now;
    }
    render(false);
  }
  function resume() {
    cancelAnimationFrame(frame);
    previous = 0;
    frameSampleStarted = 0;
    if (!disposed && ready && !paused && !document.hidden && !overlay) frame = requestAnimationFrame(draw);
    else render();
  }
  function sectionChanged() {
    overlay = document.body.dataset.workspaceSection === "timeline";
    resume();
  }
  const observer = new ResizeObserver(resize);
  if (canvas.parentElement) observer.observe(canvas.parentElement);
  document.addEventListener("visibilitychange", resume);
  window.addEventListener("hyper:section-change", sectionChanged);
  const unsubscribeVoice = subscribeWorldVoice(() => {
    if (disposed || !paused || !ready || document.hidden || overlay) return;
    agentAura?.update(elapsed, 0, getWorldVoiceVisual(), true);
    render();
  });

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
      const previousMotion = new Map(instances.map(instance => [instance.station.id, instance.motion]));
      instances.forEach(instance => instance.parts.dispose());
      stationsGroup.clear();
      instanceMaterials.forEach(material => material.dispose());
      instanceMaterials.clear();
      instances = placements.map((placement, index) => {
        const model = models[index].clone(true);
        model.position.set(placement.x, 0, -placement.y);
        model.scale.multiplyScalar(placement.scale);
        stationsGroup.add(model);
        const hover = { value: 0 };
        const motion = prepareRelic(model, hover, placement.station.template);
        const template = manifest.templates.find(template => template.id === placement.station.template);
        return { station: placement.station, model, scale: placement.scale, hover, velocity: 0, phase: index * 1.67, ...motion, motion: previousMotion.get(placement.station.id) ?? {}, labelHeight: template?.labelHeight ?? 1.42, labelSize: template?.labelSize ?? .21, arrowHeight: template?.arrowHeight ?? .86 };
      });
      scene.updateMatrixWorld(true);
      ethereal.setStations(instances.map(instance => {
        const template = manifest.templates.find(entry => entry.id === instance.station.template);
        const relic = new Box3().setFromObject(instance.icon);
        return { relicCenter: relic.getCenter(new Vector3()).sub(instance.model.position), relicSize: relic.getSize(new Vector3()), id: instance.station.id, position: instance.model.position.clone(), width: (template?.width ?? 2.2) * instance.scale, height: (template?.height ?? 4) * instance.scale, baseHeight: .48 * instance.scale };
      }));
      scene.updateMatrixWorld(true);
      if (focusedStation) api.setFocus(focusedStation, focusShare);
      bounds();
      render();
      const pearl = floating.find(item => /floating pearl marble sphere/.test(objectName(item.object)))?.object;
      atmosphere.captureRoomReflections(scene, pearl?.getWorldPosition(new Vector3()) ?? new Vector3(0, 3.16, -1.5), [water.group, ...(agentAura ? [agentAura.group] : [])]);
      render();
      canvas.dataset.ready = "true";
    },
    setPaused(value) {
      paused = value;
      water.setPaused(value);
      ethereal.update(elapsed, 0, value);
      if (value) { animateRelics(0, true); animateRoom(0, true); agentAura?.update(elapsed, 0, getWorldVoiceVisual(), true); bounds(); }
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
    setFocusListener(listener) { focusListener = listener; },
    setRelicMotion(id, state) {
      const instance = instances.find(entry => entry.station.id === id);
      if (instance) instance.motion = state;
      if (paused) { animateRelics(0, true); render(); }
    },
    setFocus(id, visibleShare = 1) {
      focusShare = visibleShare;
      if (focusedStation !== id) {
        const previous = instances.find(entry => entry.station.id === focusedStation);
        if (previous) previous.motion = { ...previous.motion, busy: false };
      }
      const instance = id ? instances.find(entry => entry.station.id === id) : null;
      focusedStation = instance ? instance.station.id : null;
      if (!instance) { focusRig.aim(null); if (paused) { animateRelics(0, true); animateRoom(0, true); render(); } return; }
      const box = instance.restBounds;
      const center = box.getCenter(new Vector3());
      // Frame the relic with room to breathe above its plinth, not just its own tight bounds.
      focusSubject = { center: center.clone(), reach: Math.max(box.getSize(new Vector3()).y, box.getSize(new Vector3()).x) * .5 };
      const size = box.getSize(new Vector3());
      const section = instance.station.section;
      interiorSection = ["cases", "identity", "benchmarks"].includes(section ?? "");
      if (interiorSection) {
        interior.select(instance.icon, section!);
        // Approach the center, cross the opening, then continue inside the reading chamber.
        focusRig.aim({ center, height: size.y, fill: .95, x: 0, y: 0, orbit: section === "identity" ? -.04 : .035 }, visibleShare);
      } else focusRig.aim({ center, height: Math.max(size.y * 2.05, 1.5 * instance.scale) }, visibleShare);
      if (paused) { animateRelics(0, true); animateRoom(0, true); render(); }
    },
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
      unsubscribeVoice();
      canvas.removeEventListener("webglcontextlost", api.dispose);
      signal?.removeEventListener("abort", api.dispose);
      canvas.dataset.ready = "false";
      instances.forEach(instance => instance.parts.dispose());
      instanceMaterials.forEach(material => material.dispose());
      modelCache.forEach(pending => { void pending.then(disposeModel).catch(() => {}); });
      retiredCovers.forEach(disposeModel);
      loader.dispose();
      agentAura?.dispose();
      if (room) disposeModel(room);
      orbit.traverse(object => { if (object instanceof Mesh) { object.geometry.dispose(); (Array.isArray(object.material) ? object.material : [object.material]).forEach(material => material.dispose()); } });
      sun.shadow.map?.dispose();
      atmosphere.dispose();
      water.dispose();
      sunlight.dispose();
      sideLight.dispose();
      ethereal.dispose();
      pipeline.dispose();
      interior.dispose();
      gpuProfile.dispose();
      restoreTransmission();
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
    await atmosphere.loadSurfaces();
    if (disposed) return api;
    atmosphere.decorate(room);
    scene.add(room);
    const orbitParts: Object3D[] = [];
    room.traverse(object => {
      const name = objectName(object);
      if (/delicate orbital ring/.test(name)) object.visible = false;
      if (name === "Hyper | floating pearl light at lower pole") object.visible = false;
      if (object instanceof Mesh && /floating pearl marble sphere/.test(name)) agentPearl = object;
      if (/delicate orbital ring|suspended satellite/.test(name)) orbitParts.push(object);
      if (/floating pearl marble sphere|floating mineral|floating pearl light/.test(name)) {
        floating.push({ object, position: object.position.clone(), rotation: new Vector3(object.rotation.x, object.rotation.y, object.rotation.z), phase: /marble sphere|lower pole/.test(name) ? 0 : floating.length * 1.73, amplitude: /marble sphere|lower pole/.test(name) ? .1 : .12 });
      }
    });
    scene.updateMatrixWorld(true);
    orbitParts.forEach(object => orbit.attach(object));
    if (agentPearl) {
      agentAura = createAgentAura(agentPearl);
      scene.add(agentAura.group);
      agentAura.update(0, 0, getWorldVoiceVisual());
    }
    canvas.dataset.renderer = "live-3d";
    ready = true;
    resize();
    sectionChanged();
  } catch (error) { api.dispose(); throw error; }
  return api;
}
