/* eslint-disable @typescript-eslint/no-explicit-any */
// Gl: renderer, pixel camera, fog, composer, global uniforms,
// global textures, troika font preload, screen FX pass (idx 101), global fluid sim + fluidPass.

import gsap from "gsap";
import {
  ClampToEdgeWrapping,
  Clock,
  Color,
  Fog,
  LinearFilter,
  LinearMipmapLinearFilter,
  PerspectiveCamera,
  RepeatWrapping,
  Scene,
  ShaderMaterial,
  Texture,
  TextureFilter,
  Vector2,
  Vector4,
  VideoTexture,
  WebGLRenderer,
  WebGLRenderTarget,
  Wrapping,
} from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import type { Pass } from "three/examples/jsm/postprocessing/Pass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { preloadFont } from "troika-three-text";
import E from "./event-bus";
import { store } from "./store";
import { assetUrl } from "./asset-url";
import { OrderedPassList } from "./ordered-passes";
import { CSS3DRenderer } from "./css3d";
import { ThreePlugin } from "./three-plugin";
import { FluidSim } from "./fluid-sim";
import { commonFullscreenUvVert } from "../shaders/common-fullscreen-uv.vert.glsl";
import { postScreenfxChromaticBarrelVignetteGrainFrag } from "../shaders/post-screenfx-chromatic-barrel-vignette-grain.frag.glsl";
import { postFluidOverlayVert } from "../shaders/post-fluid-overlay.vert.glsl";
import { postFluidOverlayFrag } from "../shaders/post-fluid-overlay.frag.glsl";

export interface TextureOptions {
  minFilter?: TextureFilter;
  magFilter?: TextureFilter;
  wrapping?: Wrapping;
  flipY?: boolean;
}

export type SceneFog = Fog & { origVals: { near: number; far: number } };

export interface GlobalUniforms {
  u_time: { value: number };
  u_delta: { value: number };
  u_resolution: { value: Vector2 };
  fogNear: { value: number };
  fogFar: { value: number };
  fogColor: { value: Color };
}

export class Gl {
  dom: { canvas: HTMLCanvasElement };
  assets: { models: Record<string, any>; textures: Record<string, Texture> } = { models: {}, textures: {} };
  renderer!: WebGLRenderer;
  camera!: PerspectiveCamera;
  scene!: Scene & { fog: SceneFog };
  composer!: EffectComposer;
  composerPasses!: OrderedPassList<Pass>;
  clock!: Clock;
  cssRenderer!: CSS3DRenderer;
  cssScene!: Scene;
  globalUniforms!: GlobalUniforms;
  webglFonts!: Record<string, { url: string; sdfGlyphSize: number }>;
  screenFxPass!: ShaderPass;
  fluidSim!: FluidSim;
  fluidPass!: ShaderPass;

  constructor() {
    E.bindAll(this, ["onResize"]);
    this.dom = { canvas: document.getElementById("gl") as HTMLCanvasElement };
    gsap.registerPlugin(ThreePlugin);
    this.setup();
    this.addEvents();
  }

  onRaf = (time: number) => {
    store.clockDelta = this.clock.getDelta();
    this.globalUniforms.u_time.value = time;
    this.globalUniforms.u_delta.value = store.clockDelta > 0.016 ? 0.016 : store.clockDelta;
    this.screenFxPass.uniforms.u_time.value = time;
    store.mouse.smooth.glNormalized.lerp(store.mouse.glNormalized, 0.05);
    this.composer.render();
  };

  onFPSChecked = (tier: number) => {
    if (tier < 4) {
      if (this.renderer.getPixelRatio() === 2) {
        this.renderer.setPixelRatio(1.5);
        this.composer.setPixelRatio(1.5);
      } else if (this.renderer.getPixelRatio() === 1.5 && !store.isTouch) {
        this.composer.reset(new WebGLRenderTarget(store.window.w, store.window.fullHeight, { samples: 0 } as any));
        this.renderer.setPixelRatio(1);
        this.composer.setPixelRatio(1);
      }
      this.composer.setSize(store.window.w, store.window.fullHeight);
      this.globalUniforms.u_resolution.value.set(
        store.window.w * this.renderer.getPixelRatio(),
        store.window.fullHeight * this.renderer.getPixelRatio(),
      );
    }
  };

  setup() {
    this.renderer = new WebGLRenderer({
      alpha: true,
      antialias: false,
      canvas: this.dom.canvas,
      powerPreference: "high-performance",
      stencil: false,
    });
    this.renderer.setPixelRatio(store.window.dpr <= 2 ? store.window.dpr : 2);
    this.renderer.setSize(store.window.w, store.window.fullHeight);
    const Z = 1500;
    const fov = (2 * Math.atan(store.window.fullHeight / 2 / Z) * 180) / Math.PI;
    this.camera = new PerspectiveCamera(fov, store.window.w / store.window.fullHeight, 1, 2200);
    this.camera.position.set(0, 0, Z);
    this.scene = new Scene() as Scene & { fog: SceneFog };
    this.scene.fog = new Fog(0xffffff, Z, this.camera.far) as SceneFog;
    this.scene.fog.origVals = { near: this.scene.fog.near, far: this.scene.fog.far };
    store.AssetLoader!.ktxLoader.detectSupport(this.renderer);
    const size = this.renderer.getDrawingBufferSize(new Vector2());
    const samples = store.isTouch ? 0 : store.window.dpr > 1 ? 1 : 2;
    const rt = new WebGLRenderTarget(size.width, size.height, { samples } as any);
    this.composer = new EffectComposer(this.renderer, rt);
    this.composerPasses = new OrderedPassList<Pass>(this.composer.passes);
    this.clock = new Clock();
    this.cssRenderer = new CSS3DRenderer();
    this.cssRenderer.setSize(store.window.w, store.window.fullHeight);
    const css = this.cssRenderer.domElement.style;
    css.position = "absolute";
    css.top = "0";
    css.zIndex = "60";
    css.pointerEvents = "none";
    css.opacity = "0";
    css.visibility = "hidden";
    document.body.appendChild(this.cssRenderer.domElement);
    this.cssScene = new Scene();
    this.globalUniforms = {
      u_time: { value: 0 },
      u_delta: { value: 0 },
      u_resolution: {
        value: new Vector2(
          store.window.w * this.renderer.getPixelRatio(),
          store.window.fullHeight * this.renderer.getPixelRatio(),
        ),
      },
      fogNear: { value: Z },
      fogFar: { value: this.camera.far },
      fogColor: { value: new Color() },
    };
    this.loadGlobalAssets();
  }

  loadGlobalAssets() {
    const loader = store.AssetLoader!;
    this.webglFonts = {
      "Neue Montreal": { url: `${store.assetsUrl}fonts/NeueMontreal-Regular.woff`, sdfGlyphSize: 128 },
      "Saol Display": { url: `${store.assetsUrl}fonts/SaolDisplay-LightItalic.woff`, sdfGlyphSize: 128 },
    };
    loader.add(
      new Promise<void>((resolve) => {
        preloadFont(
          {
            font: this.webglFonts["Neue Montreal"].url,
            characters: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789’()&-,",
            sdfGlyphSize: this.webglFonts["Neue Montreal"].sdfGlyphSize,
          },
          resolve,
        );
      }),
    );
    loader.add(
      new Promise<void>((resolve) => {
        preloadFont(
          {
            font: this.webglFonts["Saol Display"].url,
            characters: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789’()&-",
            sdfGlyphSize: this.webglFonts["Saol Display"].sdfGlyphSize,
          },
          resolve,
        );
      }),
    );
    loader.loadTexture(assetUrl("images/matcap-white.png")).then((t) => {
      this.assets.textures.matcap = t;
    });
    loader.loadTexture(assetUrl("images/matcap-black.png")).then((t) => {
      this.assets.textures.matcapBlack = t;
    });
    loader.loadTexture(assetUrl("images/project-model-matcap.png")).then((t) => {
      this.assets.textures.projectModelMatcap = t;
    });
    loader.loadTexture(assetUrl("images/project-model-matcap-dark.png")).then((t) => {
      this.assets.textures.projectModelMatcapDark = t;
    });
    loader.loadTexture(assetUrl("images/noise-small.png"), { wrapping: RepeatWrapping }).then((t) => {
      this.assets.textures.noiseSmall = t;
    });
    loader.loadTexture(assetUrl("images/gradient-noise.jpg"), { wrapping: RepeatWrapping }).then((t) => {
      this.assets.textures.gradientNoise = t;
    });
  }

  generateTexture(src: any, opts: TextureOptions = {}, isKtx = false): Texture {
    let tex: Texture = src;
    if (src instanceof HTMLImageElement) tex = new Texture(src);
    else if (src instanceof HTMLVideoElement) tex = new VideoTexture(src);
    tex.minFilter = opts.minFilter || (isKtx ? LinearFilter : LinearMipmapLinearFilter);
    tex.magFilter = (opts.magFilter || LinearFilter) as any;
    tex.wrapS = tex.wrapT = opts.wrapping || ClampToEdgeWrapping;
    tex.flipY = opts.flipY === undefined || opts.flipY;
    tex.needsUpdate = true;
    this.renderer.initTexture(tex);
    return tex;
  }

  addPasses() {
    this.screenFxPass = new ShaderPass({
      uniforms: {
        tDiffuse: { value: null },
        u_time: { value: 0 },
        u_noiseOnly: { value: 0 },
        u_maxDistort: { value: 0.4 },
        u_bendAmount: { value: -0.15 },
        u_vignetteStrength: { value: store.urlParams.has("novignette") ? 0 : 0.05 },
        // Glass bounds use CSS pixels, independent of renderer pixel ratio.
        u_glassRect: { value: new Vector4() },
        u_glassRadius: { value: 24 },
        u_glassStrength: { value: 0 },
        u_glassViewport: { value: new Vector2(store.window.w, store.window.fullHeight) },
      },
      fragmentShader: postScreenfxChromaticBarrelVignetteGrainFrag,
      vertexShader: commonFullscreenUvVert,
    });
    this.fluidSim = new FluidSim({
      fluid: {
        resolution: 128,
        force: 20,
        iterations: 1,
        mouseRadius: 0.2,
        pressure: 0.999,
        viscosity: 0.999,
        forceClamp: false,
      },
    });
    this.fluidPass = new ShaderPass(
      new ShaderMaterial({
        vertexShader: postFluidOverlayVert,
        fragmentShader: postFluidOverlayFrag,
        uniforms: {
          uFluidTexture: { value: this.fluidSim.velocitySim.texture },
          tDiffuse: { value: null },
          uOpacity: { value: 0.03 },
          uImageDistortion: { value: 0 },
          uRamp: { value: new Vector2(0, 1) },
        },
      }),
    );
    this.composerPasses.add(this.screenFxPass, 101);
  }

  addEvents() {
    E.on(store.events.RESIZE, this.onResize);
    store.RAFCollection!.add(this.onRaf, 99);
    E.on("FPSChecked", this.onFPSChecked);
  }

  onResize() {
    this.camera.fov = (2 * Math.atan(store.window.fullHeight / 2 / this.camera.position.z) * 180) / Math.PI;
    this.camera.aspect = store.window.w / store.window.fullHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(store.window.w, store.window.fullHeight);
    this.composer.setSize(store.window.w, store.window.fullHeight);
    this.cssRenderer.setSize(store.window.w, store.window.fullHeight);
    this.screenFxPass?.uniforms.u_glassViewport.value.set(store.window.w, store.window.fullHeight);
    this.globalUniforms.u_resolution.value.set(
      store.window.w * this.renderer.getPixelRatio(),
      store.window.fullHeight * this.renderer.getPixelRatio(),
    );
  }
}

export default Gl;
