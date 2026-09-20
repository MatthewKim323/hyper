/* eslint-disable @typescript-eslint/no-explicit-any */
// ProjectMenu: the scene behind /onboarding and /world. Fogged hall of arches, floor tiles, god rays,
// flocking butterflies and the WebGL project card grid (wheel / drag scroll, hover, click, filters).
import {
  AdditiveBlending,
  Box3,
  CanvasTexture,
  Color,
  DoubleSide,
  Euler,
  Fog,
  Group,
  InstancedMesh,
  LinearFilter,
  MathUtils,
  Mesh,
  MeshMatcapMaterial,
  Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  Quaternion,
  Raycaster,
  RepeatWrapping,
  Scene,
  ShaderMaterial,
  Vector2,
  Vector3,
  WebGLRenderTarget,
} from "three";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { SavePass } from "three/examples/jsm/postprocessing/SavePass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import gsap from "gsap";
import { store as storeRaw } from "../../core/store";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const store: any = storeRaw;
import { E } from "../../core/event-bus";
import { assetUrl } from "../../core/asset-url";
import { BrownianMotion } from "../../core/brownian";
import { ResourceTracker } from "../../core/dispose";
import { Butterflies } from "./butterflies";
import { ensureProjects, type ProjectEntry } from "./projects-data";
import { projectsCardWaveBendFluidVert } from "../../shaders/projects-card-wave-bend-fluid.vert.glsl";
import { projectsCardCoverFogFrag } from "../../shaders/projects-card-cover-fog.frag.glsl";
import { projectsGodraysVert } from "../../shaders/projects-godrays.vert.glsl";
import { projectsGodraysNoiseFrag } from "../../shaders/projects-godrays-noise.frag.glsl";
import { projectsToProjectTransitionVert } from "../../shaders/projects-to-project-transition.vert.glsl";
import { projectsToProjectWipeFrag } from "../../shaders/projects-to-project-wipe.frag.glsl";

type XY = { x: number; y: number };

// A project Group: [0] image card mesh, [1] caption mesh, plus the fields assigned in buildProjects
// (name, description, url, bgColor, lightMode, categories, isExternal, bbox).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ProjectGroup = any;

const $ = (sel: string) => document.querySelector(sel) as HTMLElement;

// Original light surfaces and warm rays keep the hall bright behind the dark orb.
const SCENE_PALETTE = {
  background: "#e5e5e5",
  arches: "#e5e5e5",
  floor: "#e5e5e5",
  butterflies: "#ffffff",
  light: "#ffe5c0",
};

export class ProjectMenu {
  scene: Scene;
  camera: PerspectiveCamera;
  firstLoad = false;
  hasAnimatedIn = false;
  dummyObject = new Object3D();
  initialCameraPos = 2e3;
  initialCameraPosition: Vector3;
  initialColor: number;
  colorBlackHex = 0;
  colorWhiteHex = 16777215;
  colorBlack: Color;
  colorWhite: Color;
  nearClip: number;
  farClip: number;
  options = {
    mouseMoveAngleX: 0.05,
    mouseMoveAngleY: 0.035,
    cameraZOffset: 1e3,
    cameraMotionPosAmplitude: 0.026,
    cameraMotionRotAmplitude: 0.0132,
    cameraMotionPosFrequency: 0.21,
    cameraMotionRotFrequency: 0.59,
    cameraMovementMultiplier: 1,
  };
  brownianMotion: any;
  _q = new Quaternion();
  _e = new Euler();
  resourceTracker: any;
  smoothMouse = new Vector2();
  smoothMouse2 = new Vector2();
  raycaster = new Raycaster();
  clickableItems: ProjectGroup[] = [];
  intersects: ProjectGroup[] = [];
  hoveredItem: ProjectGroup | false | undefined;
  pointerDown?: boolean;
  originalScreenFxBendAmount: number;
  originalScreenFxMaxDistort: number;
  originalScreenFxVignetteStrength: number;
  initialScrollPos = 0;
  scrollPos = 0;
  meshSizeMultiplers = { default: 0.21, sm: 0.3, md: 0.28, lg: 0.35 };
  meshSize = new Vector2(820, 430);
  toProjectTransitionData: { bgColor: string | null; lightMode: boolean | null } = {
    bgColor: null,
    lightMode: null,
  };
  tweenParams = {
    smoothScrollPos: 0,
    cameraXOffset: 0,
    cameraYOffset: 0,
    cameraZOffset: 0,
    cameraYRotationOffset: 0,
    velocity: 0,
  };
  globalUniforms = {
    u_velocity: { value: 0 },
    uSunDirection: { value: new Vector3() },
    uSunColor: { value: new Color(16777215) },
  };
  scrollDelta = 0;
  smoothScrollDelta = 0;
  allowControl = false;
  dragging = false;
  animatingFilter = false;
  ctaVisible = false;
  butterflies: Butterflies;
  assets: { projects: { textures: Record<string, any>; models: Record<string, any> }[]; models: Record<string, any>; textures: Record<string, any> } = {
    projects: [],
    models: {},
    textures: {},
  };

  // built later
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  projects!: any;
  projectsHeight = 0;
  sceneScale = 1;
  textCanvas!: HTMLCanvasElement;
  ctx!: CanvasRenderingContext2D;
  canvasArrow!: HTMLImageElement;
  archMaterial!: MeshMatcapMaterial;
  arches!: InstancedMesh;
  archLength = 0;
  archScrollOffset = 0;
  archesGroup!: Group;
  floorMaterial!: MeshMatcapMaterial;
  floor!: InstancedMesh;
  floorLength = 0;
  floorScrollOffset = 0;
  floorGroup!: Group;
  godrayLength = 0;
  godrayScrollOffset = 0;
  godrays!: InstancedMesh<PlaneGeometry, ShaderMaterial>;
  godraysGroup!: Group;
  renderPass!: RenderPass;
  savePass!: SavePass;
  transitionPass!: ShaderPass;
  inTimeline?: gsap.core.Timeline;

  DOMScale = (e: PerspectiveCamera, t: XY = { x: store.window.w, y: store.window.h }, i: XY = { x: store.window.w, y: store.window.h }) => {
    const s = this.DOMViewport(e);
    return { x: (t.x / i.x) * s.x, y: (t.y / i.y) * s.y };
  };

  DOMPosition = (
    e: PerspectiveCamera,
    t: XY = { x: 1, y: 1 },
    i: XY = { x: 0, y: 0 },
    s: XY = { x: store.window.w, y: store.window.h },
  ) => {
    const n = this.DOMViewport(e);
    return {
      x: t.x / 2 - n.x / 2 + (i.x / s.x) * n.x,
      y: -t.y / 2 + n.y / 2 - (i.y / s.y) * n.y,
    };
  };

  DOMViewport = (e: PerspectiveCamera) => {
    const t = e.fov * (Math.PI / 180),
      i = 2 * Math.tan(t / 2) * e.position.z;
    return { x: i * e.aspect, y: i };
  };

  onProjectFiltersChange = (e: string[]) => {
    this.animatingFilter = true;
    this.allowControl = false;
    const t = gsap.timeline({ defaults: { duration: 0.5, ease: "power2.out" } });
    let i = 0;
    this.projects.children.forEach((g: ProjectGroup) => {
      if (g.visible) {
        t.to(g.position, { z: 900 }, 0.035 * i);
        t.to(
          [g.children[0].material.uniforms.u_opacity, g.children[1].material.uniforms.u_opacity],
          { value: 0, duration: 0.3 },
          "<",
        );
        i++;
      }
    });
    t.call(
      () => {
        this.projects.children.forEach((g: ProjectGroup) => {
          g.visible = e.includes(g.name);
        });
        this.positionProjects();
      },
      undefined,
      ">",
    );
    t.addLabel("positionsUpdated", ">");
    i = 0;
    this.projects.children.forEach((g: ProjectGroup) => {
      if (e.includes(g.name)) {
        t.fromTo(g.position, { z: 1100 }, { z: 1e3, immediateRender: false }, "positionsUpdated+=" + 0.035 * i);
        t.to([g.children[0].material.uniforms.u_opacity, g.children[1].material.uniforms.u_opacity], { value: 1 }, "<");
        i++;
      }
    });
    t.then(() => {
      this.animatingFilter = false;
      this.allowControl = true;
    });
  };

  onScroll = (e: WheelEvent) => {
    if (!this.allowControl) return;
    const t = 1 * e.deltaY;
    this.scrollPos += t;
    this.scrollPos = MathUtils.clamp(this.scrollPos, 0, this.projectsHeight);
  };

  onDrag = ({ py: e, y: t }: { py: number; y: number }) => {
    if (!this.allowControl) return;
    Math.abs(e - t) > 3 && (this.dragging = true);
    const i = 1.5 * -(e - t);
    this.scrollPos -= i;
    this.scrollPos = MathUtils.clamp(this.scrollPos, 0, this.projectsHeight);
  };

  onClick = (e: { event: Event }) => {
    if (!this.allowControl) return;
    const target = e.event.target as Element | null;
    if (!target || !target.hasAttribute || !target.hasAttribute("asscroll-container")) return;
    if (this.dragging) {
      this.dragging = false;
    } else if (this.hoveredItem) {
      this.toProjectTransitionData.bgColor = this.hoveredItem.bgColor;
      this.toProjectTransitionData.lightMode = this.hoveredItem.lightMode;
      // External cards open their configured link in a new tab. Cards without a link stay in place.
      if (this.hoveredItem.isExternal) {
        this.hoveredItem.url && window.open(this.hoveredItem.url, "_blank");
      } else store.Highway.redirect(this.hoveredItem.url, "toProject");
    }
  };

  onPreSceneRaf = () => {
    this.smoothMouse.lerp(store.mouse.glNormalized, 0.075);
    this.smoothMouse2.lerp(store.mouse.glNormalized, 0.02);
    this.updateCamera();
  };

  onRaf = () => {
    this.butterflies.update();
    this.calculateVelocity();
    this.updateScrollPos();
    this.updateProjectHoverPositions();
    this.updateRaycaster();
    this.projects.position.y = this.tweenParams.smoothScrollPos;
    if (this.projects.children.length > 0 && this.tweenParams.smoothScrollPos > this.projectsHeight - 50 && !this.ctaVisible) {
      this.ctaVisible = true;
      gsap.to(".js-project-grid-cta", { autoAlpha: 1, duration: 0.3, ease: "power2.out" });
    } else if (this.tweenParams.smoothScrollPos < this.projectsHeight - 50 && this.ctaVisible) {
      this.ctaVisible = false;
      gsap.to(".js-project-grid-cta", { autoAlpha: 0, duration: 0.3, ease: "power2.out" });
    }
  };

  onResize = () => {
    this.scaleScene();
    this.positionProjects();
    this.camera.fov = (2 * Math.atan(store.window.fullHeight / 2 / this.camera.position.z) * 180) / Math.PI;
    this.camera.aspect = store.window.w / store.window.fullHeight;
    this.camera.updateProjectionMatrix();
  };

  constructor() {
    ensureProjects();
    this.scene = new Scene();
    this.camera = store.Gl.camera.clone() as PerspectiveCamera;
    this.camera.position.z = this.initialCameraPos;
    this.camera.fov = (2 * Math.atan(store.window.fullHeight / 2 / this.camera.position.z) * 180) / Math.PI;
    this.camera.near = 100;
    this.camera.far = 4500;
    this.camera.updateProjectionMatrix();
    this.initialCameraPosition = this.camera.position.clone();
    this.initialColor = new Color(SCENE_PALETTE.background).getHex();
    this.scene.fog = new Fog(this.initialColor, 500, this.camera.far);
    const fog = this.scene.fog as Fog;
    store.Gl.globalUniforms.fogColor.value.copy(fog.color);
    store.Gl.globalUniforms.fogNear.value = fog.near;
    store.Gl.globalUniforms.fogFar.value = fog.far;
    this.scene.background = new Color(this.initialColor);
    this.colorBlack = new Color(this.colorBlackHex);
    this.colorWhite = new Color(this.colorWhiteHex);
    this.nearClip = this.camera.position.z;
    this.farClip = this.camera.far - this.camera.position.z;
    this.brownianMotion = new BrownianMotion();
    this.brownianMotion.positionAmplitude = this.options.cameraMotionPosAmplitude;
    this.brownianMotion.rotationAmplitude = this.options.cameraMotionRotAmplitude;
    this.brownianMotion.positionFrequency = this.options.cameraMotionPosFrequency;
    this.brownianMotion.rotationFrequency = this.options.cameraMotionRotFrequency;
    this.brownianMotion.positionScale.multiplyScalar(0.1);
    this.resourceTracker = new ResourceTracker();
    this.originalScreenFxBendAmount = store.Gl.screenFxPass.uniforms.u_bendAmount.value;
    this.originalScreenFxMaxDistort = store.Gl.screenFxPass.uniforms.u_maxDistort.value;
    this.originalScreenFxVignetteStrength = store.Gl.screenFxPass.uniforms.u_vignetteStrength.value;
    this.scrollPos = this.initialScrollPos;
    this.tweenParams.smoothScrollPos = this.initialScrollPos;
    this.butterflies = new Butterflies();
    this.loadArches();
    this.load();
  }

  preBuild() {
    this.buildArches();
    this.buildFloor();
    this.preBuildPasses();
    this.buildGodRays();
    this.buildProjects();
    this.buildProjectTextCanvas();
    this.butterflies.build(new Color(SCENE_PALETTE.butterflies));
    this.scene.add(this.butterflies);
    this.onResize();
    E.on(store.events.RESIZE, this.onResize);
  }

  build(e = false) {
    store.body.classList.remove("dark");
    store.ASScroll.containerElement.style.zIndex = 50;
    this.firstLoad && this.enable();
    gsap.to(store.Gl.screenFxPass.uniforms.u_vignetteStrength, { value: this.originalScreenFxVignetteStrength });
    if (e) {
      this.addEvents();
    } else {
      this.addInteractionEvents();
      this.in();
      this.hasAnimatedIn = true;
    }
  }

  enable() {
    this.addPreSceneEvents();
    this.options.cameraMovementMultiplier = 1;
    this.renderPass.enabled = true;
    store.isTouch || store.Gl.fluidSim.enable();
  }

  in() {
    this.inTimeline = gsap.timeline({ defaults: { duration: 2, ease: "expo.out" } });
    this.allowControl = true;
  }

  scaleScene() {
    this.sceneScale = store.window.w / 2150;
    const sy = this.sceneScale * (store.mq.sm.matches ? 1 : 1.75);
    this.arches.scale.set(this.sceneScale, sy, 1);
    this.floor.scale.set(this.sceneScale, sy, 1);
  }

  buildProjectTextCanvas() {
    this.textCanvas = document.createElement("canvas");
    this.textCanvas.width = 820;
    this.textCanvas.height = 74;
    this.ctx = this.textCanvas.getContext("2d") as CanvasRenderingContext2D;
    this.ctx.fillStyle = "#000000";
    this.projects.children.forEach((e: ProjectGroup) => {
      e.children[1].material.uniforms.uTexture.value = new CanvasTexture(this.textCanvas);
    });
  }

  buildProjects() {
    this.projects = new Group();
    this.projectsHeight = 0;
    const projects = window.projects as ProjectEntry[];
    for (let e = 0; e < projects.length; e++) {
      const t = new Group() as unknown as ProjectGroup;
      const p = projects[e].project;
      t.name = p.title;
      t.description = p.description;
      t.url = p.link as string;
      t.bgColor = p.bg_color as string;
      t.lightMode = p.light_mode as boolean;
      t.categories = p.project_grid_category;
      t.isExternal = "0" === p["0internal_or_external"];
      const i = "image";
      // Cards support image textures and video texture dimensions.
      const n = { x: projects[e].images[0].image_size[0], y: projects[e].images[0].image_size[1] };
      const r = new Mesh(
        new PlaneGeometry(1, 1, 12, 12),
        new ShaderMaterial({
          vertexShader: projectsCardWaveBendFluidVert,
          fragmentShader: projectsCardCoverFogFrag,
          uniforms: {
            uTexture: { value: this.assets.projects[e].textures[projects[e].images[0].name] },
            fogColor: { value: (this.scene.fog as Fog).color },
            fogNear: { value: (this.scene.fog as Fog).near },
            fogFar: { value: (this.scene.fog as Fog).far },
            u_random: { value: Math.random() + 1 },
            u_fluidTex: { value: store.Gl.fluidSim.velocitySim.texture },
            u_imageSize: { value: new Vector2(n.x, n.y) },
            u_meshSize: { value: new Vector2() },
            u_innerScale: { value: 1 },
            u_heightOffset: { value: 1 },
            u_bendPoint: { value: new Vector2(130, 530) },
            u_opacity: { value: 1 },
            ...store.Gl.globalUniforms,
          },
          defines: { FLUID: !store.isTouch },
          depthWrite: false,
          transparent: true,
          side: DoubleSide,
        }),
      ) as ProjectGroup;
      r.renderOrder = e;
      r.frustumCulled = false;
      r.mediaType = i;
      t.add(r);
      const a = new Mesh(
        new PlaneGeometry(1, 1, 12, 12),
        new ShaderMaterial({
          vertexShader: projectsCardWaveBendFluidVert,
          fragmentShader: projectsCardCoverFogFrag,
          uniforms: {
            uTexture: { value: null },
            fogColor: { value: (this.scene.fog as Fog).color },
            fogNear: { value: (this.scene.fog as Fog).near },
            fogFar: { value: (this.scene.fog as Fog).far },
            u_random: { value: Math.random() + 1 },
            u_fluidTex: { value: store.Gl.fluidSim.velocitySim.texture },
            u_imageSize: { value: new Vector2() },
            u_meshSize: { value: new Vector2() },
            u_innerScale: { value: 1 },
            u_heightOffset: { value: 0 },
            u_bendPoint: { value: new Vector2(130, 530) },
            u_opacity: { value: 1 },
            ...store.Gl.globalUniforms,
          },
          defines: { FLUID: !store.isTouch },
          depthWrite: false,
          transparent: true,
          side: DoubleSide,
        }),
      );
      a.renderOrder = e + 1;
      a.frustumCulled = false;
      t.add(a);
      const l = new Box3();
      l.setFromObject(t);
      t.bbox = l;
      this.clickableItems.push(t);
      t.categories && t.categories.includes("experiment") && (t.visible = false);
      this.projects.add(t);
    }
    this.scene.add(this.projects);
  }

  positionProjects() {
    this.projectsHeight = 0;
    if (this.projects.children.length === 0) {
      this.scrollPos = this.tweenParams.smoothScrollPos = 0;
      return;
    }
    const e = new Vector3(),
      t = $(".js-project-filters").getBoundingClientRect(),
      i = this.DOMScale(this.camera, { x: t.x, y: t.y }, { x: store.window.w, y: store.window.h }),
      n = this.DOMPosition(this.camera, { x: i.x, y: i.y }, { x: 0, y: t.bottom }, { x: store.window.w, y: store.window.h });
    this.textCanvas.width = 820;
    this.textCanvas.height = 74;
    const r = this.meshSize.clone(),
      a = new Vector2();
    if (store.mq.lg.matches) {
      r.multiplyScalar(this.meshSizeMultiplers.lg);
      a.set(100, 700);
      a.multiplyScalar(store.window.h / 1100);
    } else if (store.mq.md.matches) {
      r.multiplyScalar(this.meshSizeMultiplers.md);
      a.set(100, 700);
      a.multiplyScalar(store.window.h / 1100);
    } else if (store.mq.sm.matches) {
      r.multiplyScalar(this.meshSizeMultiplers.sm);
      a.set(100, 500);
    } else {
      r.multiplyScalar(this.meshSizeMultiplers.default);
      a.set(100, 600);
    }
    let l = this.meshSizeMultiplers.default;
    store.mq.lg.matches
      ? (l = this.meshSizeMultiplers.lg)
      : store.mq.md.matches
        ? (l = this.meshSizeMultiplers.md)
        : store.mq.sm.matches && (l = this.meshSizeMultiplers.sm);
    let c = 1;
    store.mq.xlg.matches ? (c = this.sceneScale + 0.2) : store.mq.lg.matches && (c = this.sceneScale + 0.3);
    r.multiplyScalar(c);
    l *= c;
    const h = r.y + 24;
    let u = 0;
    this.projects.children.forEach((g: ProjectGroup) => {
      if (!g.visible) return;
      const img = g.children[0],
        cap = g.children[1];
      const ctx = this.ctx;
      ctx.clearRect(0, 0, this.textCanvas.width, this.textCanvas.height);
      ctx.fillStyle = "#000000";
      ctx.font = '600 26px "Neue Montreal", sans-serif';
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.fillText(g.name, 0, 0);
      ctx.font = '400 26px "Neue Montreal", sans-serif';
      ctx.fillText(g.description, 0, 32);
      ctx.fillStyle = "#000000";
      ctx.fillRect(0, this.textCanvas.height - 1.5, this.textCanvas.width, 1.5);
      ctx.drawImage(this.canvasArrow, this.textCanvas.width - 16, this.textCanvas.height - 36, 16, 16);
      cap.material.uniforms.uTexture.value.needsUpdate = true;
      store.Gl.renderer.initTexture(cap.material.uniforms.uTexture.value);
      cap.material.uniforms.u_imageSize.value.set(this.textCanvas.width, this.textCanvas.height);
      cap.material.uniforms.u_meshSize.value.set(this.textCanvas.width, this.textCanvas.height);
      cap.material.uniforms.u_heightOffset.value = 430 / this.textCanvas.height;
      cap.scale.set(this.textCanvas.width * l, this.textCanvas.height * l, 1);
      cap.material.uniforms.u_bendPoint.value.copy(a);
      img.material.uniforms.u_bendPoint.value.copy(a);
      img.scale.set(r.x, r.y, 1);
      img.material.uniforms.u_meshSize.value.copy(r);
      cap.position.x = 0.5 * -r.x + 0.5 * cap.scale.x;
      cap.position.y = 0.5 * -r.y - 0.5 * cap.scale.y - 6;
      const d = store.mq.md.matches ? 2 : 1;
      let m = store.mq.md.matches ? 20 : 10;
      m *= c;
      let p: number,
        f = (u % d) * r.x;
      p = store.mq.md.matches ? Math.floor(u / d) * h - n.y / 2 + 80 : Math.floor(u / d) * h - n.y / 2 + 30;
      f += (u % d) * m;
      p += Math.floor(u / d) * m;
      d > 1 && (f -= 0.5 * (r.x + m));
      u % d == 0 && (this.projectsHeight += h);
      g.position.set(f, -p, 1e3);
      g.bbox.getSize(e);
      u++;
    });
    store.mq.md.matches
      ? (this.projectsHeight -= h - 250 * c + 0.1 * store.window.h)
      : (this.projectsHeight -= h - 250 + 0.1 * store.window.h);
    this.scrollPos = this.tweenParams.smoothScrollPos = 0;
  }

  buildArches() {
    this.archMaterial = new MeshMatcapMaterial({
      matcap: store.Gl.assets.textures.projectModelMatcap,
      color: SCENE_PALETTE.arches,
    });
    this.arches = new InstancedMesh(this.assets.models.arch.geometry, this.archMaterial, 5);
    this.dummyObject.scale.setScalar(300);
    this.dummyObject.rotation.set(0, MathUtils.degToRad(90), 0);
    this.archLength = 2 * this.dummyObject.scale.x;
    this.archScrollOffset = this.archLength;
    for (let e = 0; e < 5; e++) {
      this.dummyObject.position.set(0, 300, -this.archLength * e);
      this.dummyObject.updateMatrix();
      this.arches.setMatrixAt(e, this.dummyObject.matrix);
    }
    this.archesGroup = new Group();
    this.archesGroup.add(this.arches);
    this.archesGroup.position.z = this.initialScrollPos;
    this.arches.position.z = 200;
    this.scene.add(this.archesGroup);
  }

  buildFloor() {
    this.floorMaterial = new MeshMatcapMaterial({
      matcap: store.Gl.assets.textures.projectModelMatcap,
      color: SCENE_PALETTE.floor,
      transparent: true,
      depthWrite: false,
    });
    const geo = this.assets.models.floor.geometry;
    this.floor = new InstancedMesh(geo, this.floorMaterial, 3);
    geo.rotateY(MathUtils.degToRad(-90));
    this.dummyObject.scale.setScalar(300);
    this.dummyObject.rotation.set(0, 0, 0);
    geo.computeBoundingBox();
    this.floorLength = (-geo.boundingBox.min.z + geo.boundingBox.max.z) * this.dummyObject.scale.x * 2 - 70;
    this.floorScrollOffset = this.floorLength;
    for (let e = 0; e < 3; e++) {
      this.dummyObject.position.set(0, -300, 0.5 * -this.floorLength * e);
      this.dummyObject.rotation.set(0, MathUtils.degToRad(180) * (e % 2), 0);
      this.dummyObject.updateMatrix();
      this.floor.setMatrixAt(e, this.dummyObject.matrix);
    }
    this.floorGroup = new Group();
    this.floorGroup.add(this.floor);
    this.floorGroup.position.z = this.initialScrollPos;
    this.floor.position.z = 0.3 * this.floorLength;
    this.scene.add(this.floorGroup);
  }

  buildGodRays() {
    this.godrayLength = 1500;
    this.godrayScrollOffset = 1500;
    this.godrays = new InstancedMesh(
      new PlaneGeometry(),
      new ShaderMaterial({
        vertexShader: projectsGodraysVert,
        fragmentShader: projectsGodraysNoiseFrag,
        uniforms: {
          uTime: store.Gl.globalUniforms.u_time,
          uNoiseTexture: { value: store.Gl.assets.textures.gradientNoise },
          fogNear: { value: (this.scene.fog as Fog).near },
          fogFar: { value: (this.scene.fog as Fog).far },
          uDirection: { value: new Vector2(-100, -150) },
          uStrength: { value: 0.25 },
          uLength: { value: 0.4 },
          uFadeSmoothness: { value: 0.7 },
          uScale: { value: 0.26 },
          uSpeed: { value: 0.45 },
          uLightColor: { value: new Color(SCENE_PALETTE.light) },
        },
        transparent: true,
        depthTest: false,
        blending: AdditiveBlending,
      }),
      3,
    );
    this.godrays.renderOrder = 100;
    this.dummyObject.position.set(0, 0, 0);
    this.dummyObject.rotation.set(0, 0, 0);
    this.dummyObject.scale.set(1, 1, 1);
    const e: number[] = [];
    for (let t = 0; t < 3; t++) {
      this.dummyObject.position.set(0, 0, -this.godrayLength * t);
      this.dummyObject.scale.set(1e4, 3e3, 1);
      this.dummyObject.updateMatrix();
      this.godrays.setMatrixAt(t, this.dummyObject.matrix);
      e.push(Math.random());
    }
    this.godraysGroup = new Group();
    this.godraysGroup.add(this.godrays);
    this.godraysGroup.position.z = this.initialScrollPos;
    this.scene.add(this.godraysGroup);
  }

  preBuildPasses() {
    this.renderPass = new RenderPass(this.scene, this.camera);
    (this.renderPass as any).name = "Project Menu";
    this.renderPass.enabled = false;
    this.renderPass.clear = false;
    const pr = store.Gl.renderer.getPixelRatio();
    this.savePass = new SavePass(
      new WebGLRenderTarget(store.window.w * pr, store.window.fullHeight * pr, {
        minFilter: LinearFilter,
        magFilter: LinearFilter,
        depthBuffer: false,
      }),
    );
    (this.savePass as any).name = "Project Menu Scene Texture";
    this.savePass.enabled = false;
    this.transitionPass = new ShaderPass(
      new ShaderMaterial({
        vertexShader: projectsToProjectTransitionVert,
        fragmentShader: projectsToProjectWipeFrag,
        uniforms: {
          tDiffuse: { value: null },
          u_bgColor: { value: new Color() },
          u_progress: { value: 0 },
          u_opacity: { value: 1 },
        },
        transparent: true,
      }),
    );
    (this.transitionPass as any).name = "Project Menu to Project Transition";
    this.transitionPass.enabled = false;
    store.Gl.composerPasses.add(this.renderPass, 10);
    store.Gl.composerPasses.add(this.savePass, 11);
    store.Gl.composerPasses.add(this.transitionPass, 15);
  }

  updateScrollPos() {
    this.allowControl &&
      (this.tweenParams.smoothScrollPos += 0.05 * (this.scrollPos - this.tweenParams.smoothScrollPos));
  }

  updateCamera() {
    this.camera.position.copy(this.initialCameraPosition);
    this.camera.lookAt(0, 0, 0);
    if (!store.isTouch) {
      this.brownianMotion.update(0.5 * store.clockDelta);
      this.camera.updateMatrix();
      this.camera.matrix.multiply(this.brownianMotion.matrix);
      this.camera.matrix.decompose(this.camera.position, this.camera.quaternion, this.camera.scale);
      this.camera.translateZ(-this.options.cameraZOffset);
      this._e.set(
        this.smoothMouse.y * this.options.mouseMoveAngleY * this.options.cameraMovementMultiplier,
        -this.smoothMouse.x * this.options.mouseMoveAngleX * this.options.cameraMovementMultiplier,
        0,
      );
      this._q.setFromEuler(this._e);
      this.camera.quaternion.multiply(this._q);
      this._e.set(0, 0, -0.05 * (this.smoothMouse.x - this.smoothMouse2.x) * this.options.cameraMovementMultiplier);
      this._q.setFromEuler(this._e);
      this.camera.quaternion.multiply(this._q);
      this.camera.translateZ(this.options.cameraZOffset);
    }
    this.camera.position.x += this.tweenParams.cameraXOffset;
    this.camera.position.y += this.tweenParams.cameraYOffset;
    this.camera.position.z += this.tweenParams.cameraZOffset;
    this.camera.rotation.y += this.tweenParams.cameraYRotationOffset;
    this.camera.updateMatrixWorld();
  }

  calculateVelocity() {
    this.scrollDelta = 5e-4 * (this.scrollPos - this.tweenParams.smoothScrollPos);
    this.smoothScrollDelta = MathUtils.lerp(this.scrollDelta, 0, 0.01);
    this.tweenParams.velocity += 0.075 * (this.smoothScrollDelta - this.tweenParams.velocity);
    this.globalUniforms.u_velocity.value = this.tweenParams.velocity;
  }

  updateProjectHoverPositions() {
    this.allowControl &&
      this.projects.children.forEach((e: ProjectGroup) => {
        e.visible && e.bbox.setFromObject(e);
      });
  }

  updateRaycaster() {
    if (!this.allowControl) return;
    this.raycaster.setFromCamera(store.mouse.glNormalized, this.camera);
    if (!(store.isTouch || !this.pointerDown)) return;
    this.intersects = [];
    this.clickableItems.forEach((e) => {
      e.visible && this.raycaster.ray.intersectsBox(e.bbox) && this.intersects.push(e);
    });
    if (this.intersects.length > 0 && this.hoveredItem !== this.intersects[0]) {
      if (this.hoveredItem && this.hoveredItem.type === "Group") {
        gsap.to(this.hoveredItem.children[0].material.uniforms.u_innerScale, {
          duration: 0.3,
          ease: "power2.out",
          value: 1,
        });
      }
      this.hoveredItem = this.intersects[0];
      if (!store.isTouch) {
        gsap.to(this.hoveredItem.children[0].material.uniforms.u_innerScale, {
          duration: 0.3,
          ease: "power2.out",
          value: 1.1,
        });
        document.body.style.cursor = "pointer";
        store.Cursor.hideEnter();
      }
    } else if (0 === this.intersects.length && false !== this.hoveredItem && undefined !== this.hoveredItem) {
      if (!store.isTouch) {
        gsap.to(this.hoveredItem.children[0].material.uniforms.u_innerScale, {
          duration: 0.3,
          ease: "power2.out",
          value: 1,
        });
        document.body.style.cursor = "auto";
        store.Cursor.hideLeave();
      }
      this.hoveredItem = false;
    }
  }

  addPreSceneEvents() {
    store.RAFCollection.add(this.onPreSceneRaf, 10);
  }

  removePreSceneEvents() {
    store.RAFCollection.remove(this.onPreSceneRaf);
  }

  addEvents() {
    store.RAFCollection.add(this.onRaf, 11);
    E.on("ProjectFilters:change", this.onProjectFiltersChange);
  }

  addInteractionEvents() {
    E.on("wheel", window, this.onScroll);
    E.on(store.events.MOUSEDRAG, this.onDrag);
    E.on(store.events.MOUSEUP, this.onClick);
  }

  sampleVideos() {
    this.assets.projects.forEach((e) => {
      for (const t in e.textures)
        e.textures[t].image.play &&
          e.textures[t].image.play().then(() => {
            e.textures[t].image.pause();
          });
    });
  }

  load() {
    const projects = window.projects as ProjectEntry[];
    if (projects.length === 0) return;
    this.canvasArrow = new Image();
    store.AssetLoader.add(
      new Promise((e) => {
        this.canvasArrow.onload = e;
        this.canvasArrow.src = assetUrl("svg-sprite/arrow.svg");
      }),
    );
    for (let e = 0; e < projects.length; e++) {
      const t = projects[e],
        i: { textures: Record<string, any>; models: Record<string, any> } = { textures: {}, models: {} };
      for (let k = 0; k < t.images.length; k++)
        "ktx2" === t.images[k].image.split(".").pop()
          ? store.AssetLoader.loadKtxTexture(t.images[k].image).then((s: any) => {
              i.textures[t.images[k].name] = s;
            })
          : store.AssetLoader.loadTexture(t.images[k].image).then((s: any) => {
              i.textures[t.images[k].name] = s;
            });
      this.assets.projects.push(i);
    }
  }

  loadArches() {
    store.AssetLoader.loadKtxTexture(assetUrl("images/project-menu/arch.ktx2")).then((e: any) => {
      this.assets.textures.arch = e;
    });
    store.AssetLoader.loadTexture(assetUrl("images/project-menu/sand-rotate.jpg"), { wrapping: RepeatWrapping }).then(
      (e: any) => {
        e.repeat.set(5, 5);
        e.needsUpdate = true;
        this.assets.textures.sand = e;
      },
    );
    store.AssetLoader.loadGltf(assetUrl("models/project-menu/arch-dc.glb")).then((e: any) => {
      this.assets.models.arch = e.scene.children[0];
    });
    store.AssetLoader.loadGltf(assetUrl("models/project-menu/floor-dc.glb")).then((e: any) => {
      this.assets.models.floor = e.scene.children[0];
    });
  }

  destroy() {
    E.off("wheel", window, this.onScroll);
    E.off(store.events.MOUSEDRAG, this.onDrag);
    E.off(store.events.MOUSEUP, this.onClick);
    E.off("ProjectFilters:change", this.onProjectFiltersChange);
    store.RAFCollection.remove(this.onRaf);
    this.removePreSceneEvents();
    store.Gl.fluidSim.disable();
    store.ASScroll.containerElement.style.removeProperty("z-index");
    store.body.style.removeProperty("cursor");
    this.options.cameraMovementMultiplier = 1;
    this.camera.position.copy(this.initialCameraPosition);
    this.camera.rotation.set(0, 0, 0);
    this.scrollDelta = 0;
    this.smoothScrollDelta = 0;
    this.dragging = false;
    this.scrollPos = this.initialScrollPos;
    this.allowControl = false;
    this.tweenParams = {
      smoothScrollPos: this.initialScrollPos,
      cameraXOffset: 0,
      cameraYOffset: 0,
      cameraZOffset: 0,
      cameraYRotationOffset: 0,
      velocity: 0,
    };
    this.projects.position.y = this.initialScrollPos;
    for (let e = 0; e < this.projects.children.length; e++)
      for (let t = 0; t < this.projects.children[e].children.length; t++) {
        const i = this.projects.children[e].children[t];
        if ("video" === i.mediaType) {
          i.material.uniforms.uTexture.value.image.src = "";
          i.material.uniforms.uTexture.value.image.load();
        }
      }
    this.resourceTracker.dispose();
    this.renderPass.enabled = false;
    this.savePass.enabled = false;
    this.transitionPass.enabled = false;
  }
}
