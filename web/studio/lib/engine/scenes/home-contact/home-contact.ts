/* eslint-disable @typescript-eslint/no-explicit-any */
// HomeContact scene. One scene for `/` (cameraPathProgress 1) and `/contact/` (0).
import gsap from 'gsap';
import {
  BackSide,
  Box3,
  BufferAttribute,
  CatmullRomCurve3,
  Color,
  DoubleSide,
  EquirectangularReflectionMapping,
  Euler,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  LinearFilter,
  MathUtils,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshMatcapMaterial,
  Object3D,
  OrthographicCamera,
  PerspectiveCamera,
  PlaneGeometry,
  Quaternion,
  RawShaderMaterial,
  RepeatWrapping,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  Vector2,
  Vector3,
  WebGLRenderTarget,
  type BufferGeometry,
} from 'three';
import { MeshSurfaceSampler } from 'three/examples/jsm/math/MeshSurfaceSampler.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { SavePass } from 'three/examples/jsm/postprocessing/SavePass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { Text } from 'troika-three-text';

import { store as storeRaw } from '../../core/store';
import { E } from '../../core/event-bus';
import { assetUrl } from '../../core/asset-url';
import { FluidSim } from '../../core/fluid-sim';
import { BrownianMotion } from '../../core/brownian';
import { CSS3DObject } from '../../core/css3d';
import { ResourceTracker } from '../../core/dispose';
import { SvgButton } from '../../dom/svg-button';
import { ContentToggle } from '../../dom/content-toggle';

import { homeLandVert } from '../../shaders/home-land.vert.glsl';
import { homeLandFogFrag } from '../../shaders/home-land-fog.frag.glsl';
import { homeGrassBladeVert } from '../../shaders/home-grass-blade.vert.glsl';
import { homeGrassBladeFrag } from '../../shaders/home-grass-blade.frag.glsl';
import { homeWaterReflectorVert } from '../../shaders/home-water-reflector.vert.glsl';
import { homeWaterReflectorFrag } from '../../shaders/home-water-reflector.frag.glsl';
import { homeHeroTextVert } from '../../shaders/home-hero-text.vert.glsl';
import { homeHeroTextFluidIridescentFrag } from '../../shaders/home-hero-text-fluid-iridescent.frag.glsl';
import { homeDustParticlesBillboardVert } from '../../shaders/home-dust-particles-billboard.vert.glsl';
import { homeDustParticlesNormalmapFrag } from '../../shaders/home-dust-particles-normalmap.frag.glsl';
import { homeTransitionWipeVert } from '../../shaders/home-transition-wipe.vert.glsl';
import { homeTransitionWipeZoomFrag } from '../../shaders/home-transition-wipe-zoom.frag.glsl';

import { Reflector } from './reflector';

const o: any = storeRaw;
const n: any = E;

function p(e: string, t: ParentNode = document): HTMLElement[] {
  return Array.prototype.slice.call(t.querySelectorAll(e));
}
function f(e: string, t: ParentNode = document): HTMLElement {
  return t.querySelector(e) as HTMLElement;
}


export class HomeContact {
  scene: Scene;
  camera: PerspectiveCamera;
  firstLoad: boolean;
  renderCss: boolean;
  isHome: boolean;
  dom: Record<string, any>;
  globalUniforms: { u_time: { value: number } };
  tweenParams: { cameraPathProgress: number; cameraYOffset: number };
  devCam: boolean;
  camPos: Vector3;
  lookAt: Vector3;
  options: {
    mouseMoveAngleX: number;
    mouseMoveAngleY: number;
    cameraZOffset: number;
    cameraTranslateZ: number;
    cameraMotionPosAmplitude: number;
    cameraMotionRotAmplitude: number;
    cameraMotionPosFrequency: number;
    cameraMotionRotFrequency: number;
    homeDemo: boolean;
    disableCursor: boolean;
  };
  smoothMouse: Vector2;
  smoothMouse2: Vector2;
  resourceTracker: ResourceTracker;
  assets!: { models: Record<string, any>; textures: Record<string, any>; objectsData?: any };

  instanceDummy!: Object3D;
  brownianMotion!: any;
  objectsData!: Record<string, any>;
  container!: Group;
  homeRoom!: Mesh;
  contactRoom!: Mesh;
  chair!: Mesh;
  pillows!: Mesh;
  rocks!: Mesh;
  table!: Mesh;
  ballContainer!: Group;
  ball!: Mesh;
  world!: Mesh;
  grassSharedUniforms!: Record<string, { value: any }>;
  land!: Mesh<BufferGeometry, ShaderMaterial>;
  grass!: InstancedMesh<PlaneGeometry, RawShaderMaterial>;
  water!: Reflector;
  textScene!: Scene;
  textCamera!: OrthographicCamera;
  textRT!: WebGLRenderTarget;
  homeText!: Group & { bbox?: Box3 };
  introText!: any;
  titleText!: any;
  descriptorText!: any;
  homeTextMesh!: Mesh<PlaneGeometry, ShaderMaterial>;
  textFluidSim!: any;
  contactText!: Group;
  particles!: InstancedMesh<PlaneGeometry, ShaderMaterial>;
  fluidSim!: any;
  renderPass!: RenderPass;
  savePass!: SavePass;
  transitionPass!: ShaderPass;
  viewProjectsBtn!: any;
  contactBtns!: any[];
  viewProjectsBtn3D!: any;
  contactContent3D!: any;
  cameraCurvePath!: CatmullRomCurve3;
  cameraTargetPath!: CatmullRomCurve3;
  _q!: Quaternion;
  _e!: Euler;

  onProjectsBtnClick = () => {
    n.off('mouseenter', this.viewProjectsBtn3D.element, this.onProjectsBtnEnter);
    n.off('mouseleave', this.viewProjectsBtn3D.element, this.onProjectsBtnLeave);
  };

  onProjectsBtnEnter = () => {
    gsap.to(this.options, {
      cameraTranslateZ: -0.005,
      overwrite: true,
      duration: 2,
      ease: 'power2.out',
    });
  };

  onProjectsBtnLeave = () => {
    gsap.to(this.options, {
      cameraTranslateZ: 0,
      overwrite: true,
      duration: 1,
      ease: 'power2.out',
    });
  };

  onRaf = (e: number) => {
    this.smoothMouse.lerp(o.mouse.glNormalized, 0.075);
    this.smoothMouse2.lerp(o.mouse.glNormalized, 0.02);
    this.world.rotation.y -= 1e-4;
    this.globalUniforms.u_time.value = e;
    if (this.renderCss) {
      this.camera.position.multiplyScalar(1e3);
      o.Gl.cssRenderer.render(o.Gl.cssScene, this.camera);
      this.camera.position.multiplyScalar(0.001);
    }
    this.updateCameraPosition();
  };

  onResize = () => {
    this.camera.aspect = o.window.w / o.window.fullHeight;
    this.camera.updateProjectionMatrix();
    this.camera.setFocalLength(o.mq.sm.matches ? 36 : 42);
  };

  updateHtmlScale = () => {
    if (!this.viewProjectsBtn3D) return;
    const e = 1e3 * -(this.objectsData.ho.position.z - this.objectsData.cam.children[3].position.z);
    this.viewProjectsBtn3D.scale.setScalar(e / o.Gl.cssRenderer.cache.camera.fov);
    this.contactContent3D.scale.setScalar(100 / o.Gl.cssRenderer.cache.camera.fov);
  };

  constructor() {
    this.scene = new Scene();
    this.camera = o.Gl.camera.clone();
    this.firstLoad = false;
    this.renderCss = false;
    this.isHome = document.body.classList.contains('home');
    this.dom = {
      navHome: p('.js-nav-home'),
      navContact: p('.js-nav-contact'),
    };
    this.globalUniforms = { u_time: { value: 0 } };
    this.tweenParams = {
      cameraPathProgress: this.isHome ? 1 : 0,
      cameraYOffset: 0,
    };
    this.devCam = o.urlParams.has('devcam');
    this.camPos = new Vector3(-0.15, 0.05, 0);
    this.lookAt = new Vector3(-0.26, 0.04, -0.1);
    this.options = {
      mouseMoveAngleX: 0.135,
      mouseMoveAngleY: 0.035,
      cameraZOffset: 0.1,
      cameraTranslateZ: 0,
      cameraMotionPosAmplitude: 0.026,
      cameraMotionRotAmplitude: 0.0132,
      cameraMotionPosFrequency: 0.21,
      cameraMotionRotFrequency: 0.59,
      homeDemo: o.urlParams.has('homedemo'),
      disableCursor: o.urlParams.has('disablecursor'),
    };
    this.smoothMouse = new Vector2();
    this.smoothMouse2 = new Vector2();
    this.resourceTracker = new ResourceTracker();
    this.load();
  }

  build() {
    this.instanceDummy = new Object3D();
    this.brownianMotion = new BrownianMotion();
    this.brownianMotion.positionAmplitude = this.options.cameraMotionPosAmplitude;
    this.brownianMotion.rotationAmplitude = this.options.cameraMotionRotAmplitude;
    this.brownianMotion.positionFrequency = this.options.cameraMotionPosFrequency;
    this.brownianMotion.rotationFrequency = this.options.cameraMotionRotFrequency;
    this.brownianMotion.positionScale.multiplyScalar(0.1);
    this.mapObjectsData();
    this.camera.near = 0.001;
    this.camera.far = 2;
    this.onResize();
    this.buildObjects();
    this.buildGrass();
    this.buildWater();
    this.buildText();
    this.buildParticles();
    this.buildCameraProps();
    this.buildFluidSim();
    this.buildHtml();
    if (this.options.homeDemo && this.options.disableCursor) {
      const c = f('.cursor');
      if (c) c.style.display = 'none';
    }
    this.buildPasses();
    if (this.firstLoad) this.enable();
    n.on(o.events.RESIZE, this.onResize);
  }

  mapObjectsData() {
    this.objectsData = {};
    for (let e = 0; e < this.assets.objectsData.children.length; e++) {
      const t = this.assets.objectsData.children[e];
      this.objectsData[t.name] = t;
    }
  }

  buildObjects() {
    const tx = this.assets.textures;
    const md = this.assets.models;
    this.container = new Group();
    this.scene.add(this.container);
    tx.skymap.mapping = EquirectangularReflectionMapping;
    tx.skymap.wrapT = tx.skymap.wrapS = RepeatWrapping;
    tx.skymap.flipY = true;
    tx.skymap.repeat.set(6, 6);
    tx.skymap.offset.set(0, 1.254);
    tx.skymap.needsUpdate = true;

    this.homeRoom = md.homeRoom;
    this.homeRoom.material = new MeshBasicMaterial({ map: tx.homeRoom });
    this.applyObjectTransforms(this.homeRoom, 'room-1');
    this.homeRoom.matrixAutoUpdate = false;
    this.homeRoom.updateMatrix();
    this.container.add(this.homeRoom);

    this.contactRoom = md.contactRoom;
    this.contactRoom.material = new MeshBasicMaterial({ map: tx.contactRoom });
    this.applyObjectTransforms(this.contactRoom, 'room-2');
    this.contactRoom.matrixAutoUpdate = false;
    this.contactRoom.updateMatrix();
    this.container.add(this.contactRoom);

    this.chair = md.chair;
    this.chair.material = new MeshBasicMaterial({ map: tx.chair });
    this.applyObjectTransforms(this.chair, 'chair');
    this.chair.matrixAutoUpdate = false;
    this.chair.updateMatrix();
    this.container.add(this.chair);

    this.pillows = md.pillows;
    this.pillows.material = new MeshBasicMaterial({ map: tx.pillows });
    this.applyObjectTransforms(this.pillows, 'pillow');
    this.pillows.matrixAutoUpdate = false;
    this.pillows.updateMatrix();
    this.container.add(this.pillows);

    this.rocks = md.rocks;
    this.rocks.material = new MeshBasicMaterial({ map: tx.rock });
    this.applyObjectTransforms(this.rocks, 'rock');
    this.rocks.matrixAutoUpdate = false;
    this.rocks.updateMatrix();
    this.container.add(this.rocks);

    this.table = md.table;
    this.table.geometry.setAttribute(
      'uv2',
      new BufferAttribute((this.table.geometry.attributes.uv as BufferAttribute).array, 2),
    );
    this.table.material = new MeshBasicMaterial({
      map: tx.table,
      envMap: tx.skymap,
      reflectivity: 1,
    });
    this.applyObjectTransforms(this.table, 'table-3');
    this.table.matrixAutoUpdate = false;
    this.table.updateMatrix();
    this.container.add(this.table);

    tx.pearlMatcap.flipY = true;
    tx.pearlMatcap.needsUpdate = true;
    this.ballContainer = new Group();
    this.ball = new Mesh(new SphereGeometry(1, 20, 20), new MeshMatcapMaterial({ matcap: tx.pearlMatcap }));
    this.applyObjectTransforms(this.ballContainer, 'sphere');
    this.ballContainer.scale.setScalar(0.01);
    this.ball.geometry.computeBoundingBox();
    this.ball.position.y = (this.ball.geometry.boundingBox as Box3).max.z;
    this.ball.matrixAutoUpdate = false;
    this.ball.updateMatrix();
    this.ballContainer.add(this.ball);
    this.container.add(this.ballContainer);

    this.world = new Mesh(
      new SphereGeometry(1, 6, 6),
      new MeshBasicMaterial({ color: 16777215, map: tx.skymap, side: BackSide, fog: false }),
    );
    this.container.add(this.world);
  }

  buildGrass() {
    this.grassSharedUniforms = {
      u_baseColor: { value: new Color(14396108) },
      u_gradientNoiseTexture: { value: o.Gl.assets.textures.gradientNoise },
      fogNear: { value: 0.29 },
      fogFar: { value: 1.09 },
      fogColor: { value: new Color(14733263) },
      lightPos: { value: new Vector3(-0.26, -1.06, -0.22) },
    };
    this.land = this.assets.models.land;
    this.land.material = new ShaderMaterial({
      vertexShader: homeLandVert,
      fragmentShader: homeLandFogFrag,
      uniforms: {
        u_baseColor: this.grassSharedUniforms.u_baseColor,
        u_gradientNoiseTexture: this.grassSharedUniforms.u_gradientNoiseTexture,
        u_time: this.globalUniforms.u_time,
        fogNear: this.grassSharedUniforms.fogNear,
        fogFar: this.grassSharedUniforms.fogFar,
        fogColor: this.grassSharedUniforms.fogColor,
      },
    });
    this.applyObjectTransforms(this.land, 'land');
    this.land.matrixAutoUpdate = false;
    this.land.updateMatrix();
    this.container.add(this.land);
    const e = o.mq.md.matches ? 25e3 : o.mq.sm.matches ? 15e3 : 5e3;

    const t = new Vector3();
    const i = new Vector3();
    const nonIndexed = this.land.geometry.clone().toNonIndexed();
    const r = new Mesh(nonIndexed);
    const a = new MeshSurfaceSampler(r).build();
    const l = new PlaneGeometry(0.01, 1, 2, 5);
    const c = new Matrix4().makeTranslation(0, -0.5, 0);
    l.applyMatrix4(c);
    const h = new Matrix4().makeRotationX(-Math.PI);
    l.applyMatrix4(h);
    const u = l.attributes.position.array as Float32Array;
    for (let k = 0; k < u.length; k += 3) if (u[k + 0] === 0) u[k + 2] = 0.005;

    this.grass = new InstancedMesh(
      l,
      new RawShaderMaterial({
        vertexShader: homeGrassBladeVert,
        fragmentShader: homeGrassBladeFrag,
        uniforms: {
          u_baseColor: this.grassSharedUniforms.u_baseColor,
          u_time: this.globalUniforms.u_time,
          u_blade: { value: this.assets.textures.blade },
          u_noise: this.grassSharedUniforms.u_gradientNoiseTexture,
          u_color1: { value: new Color(16765927) },
          u_color2: { value: new Color(13931456) },
          u_matcap: { value: o.Gl.assets.textures.projectModelMatcap },
          fogNear: this.grassSharedUniforms.fogNear,
          fogFar: this.grassSharedUniforms.fogFar,
          fogColor: this.grassSharedUniforms.fogColor,
          lightPos: this.grassSharedUniforms.lightPos,
        },
        side: DoubleSide,
      }),
      e,
    );
    for (let k = 0; k < e; k++) {
      a.sample(t, i);
      this.instanceDummy.position.copy(t);
      this.instanceDummy.scale.set(0.07, 0.005, 0.07);
      this.instanceDummy.rotation.y = MathUtils.randFloat(-0.5, 0.5);
      this.instanceDummy.updateMatrix();
      this.grass.setMatrixAt(k, this.instanceDummy.matrix);
      // Convert vector components to the color channels required by setColorAt.
      this.grass.setColorAt(k, new Vector3(k, (k % 256) / 256, Math.floor(k / 256) / 256) as unknown as Color);
    }
    this.applyObjectTransforms(this.grass, 'land');
    this.grass.matrixAutoUpdate = false;
    this.grass.updateMatrix();
    this.container.add(this.grass);
  }

  buildWater() {
    this.water = new Reflector(
      new PlaneGeometry(),
      new ShaderMaterial({
        vertexShader: homeWaterReflectorVert,
        fragmentShader: homeWaterReflectorFrag,
        uniforms: {
          uNoiseTexture: { value: o.Gl.assets.textures.gradientNoise },
          uTime: o.Gl.globalUniforms.u_time,
          uColor: { value: new Color(14870006) },
          uAOTexture: { value: this.assets.textures.aoMap },
          uBaseLod: { value: 1 },
          uDistortionAmount: { value: 0.013 },
          uReflectionIntensity: { value: 0.24 },
          uFluidTexture: { value: null },
          uResolution: o.Gl.globalUniforms.u_resolution,
        },
      }),
      'water',
    );
    this.applyObjectTransforms(this.water, 'wate');
    this.water.rotation.x = MathUtils.degToRad(-90);
    this.water.position.set(-0.1193, 0.007851, 0.048929);
    this.water.scale.setScalar(0.5);
    this.water.updateMatrix();
    this.water.updateCameraScene(this.camera, this.scene);
    this.container.add(this.water);
  }

  buildText() {
    const renderer = o.Gl.renderer;
    this.textScene = new Scene();
    this.textCamera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 2);
    this.textCamera.position.z = 1;
    this.textRT = new WebGLRenderTarget(
      o.window.w * renderer.getPixelRatio() * 0.5,
      o.window.fullHeight * renderer.getPixelRatio() * 0.5,
    );
    this.homeText = new Group();

    this.introText = new Text();
    Object.assign(this.introText, {
      text: 'Matthew Kim & Stephen Hung · HackMIT',
      font: o.Gl.webglFonts['Neue Montreal'].url,
      fontSize: 0.00135,
      letterSpacing: 0.01,
      anchorX: 'center',
      anchorY: 'middle',
      color: 3487029,
      sdfGlyphSize: o.Gl.webglFonts['Neue Montreal'].sdfGlyphSize,
      textAlign: 'center',
    });
    this.introText.position.y = 0.012;
    this.homeText.add(this.introText);

    this.titleText = new Text();
    Object.assign(this.titleText, {
      text: 'hyper.',
      font: o.Gl.webglFonts['Neue Montreal'].url,
      fontSize: 0.02,
      letterSpacing: -0.05,
      anchorX: 'center',
      anchorY: 'middle',
      color: 3487029,
      sdfGlyphSize: o.Gl.webglFonts['Neue Montreal'].sdfGlyphSize,
      textAlign: 'center',
    });
    this.titleText.position.y = 0.0015;
    this.homeText.add(this.titleText);

    this.descriptorText = new Text();
    Object.assign(this.descriptorText, {
      text: 'Blocked invoices, investigated and resolved',
      font: o.Gl.webglFonts['Neue Montreal'].url,
      fontSize: 0.00135,
      letterSpacing: 0.01,
      anchorX: 'center',
      anchorY: 'middle',
      color: 3487029,
      sdfGlyphSize: o.Gl.webglFonts['Neue Montreal'].sdfGlyphSize,
      textAlign: 'center',
    });
    this.descriptorText.position.y = -0.0112;
    this.homeText.add(this.descriptorText);
    this.textScene.add(this.homeText);

    this.homeTextMesh = new Mesh(
      new PlaneGeometry(),
      new ShaderMaterial({
        vertexShader: homeHeroTextVert,
        fragmentShader: homeHeroTextFluidIridescentFrag,
        uniforms: {
          uTexture: { value: this.textRT.texture },
          uOpacity: { value: 0 },
          uFluidTexture: { value: null },
          uTextColor1: { value: new Color(16777215) },
          uTextColor2: { value: new Color(15650815) },
          uTextColor3: { value: new Color(11910143) },
          uTextColor4: { value: new Color(16048383) },
          uProgress: { value: this.firstLoad ? 0 : 1 },
        },
        transparent: true,
      }),
    );
    this.homeTextMesh.name = 'text';
    this.homeTextMesh.position.copy(this.objectsData.ho.position);
    this.homeTextMesh.rotation.y = -this.objectsData.ho.rotation.z;
    this.homeTextMesh.updateMatrixWorld();
    this.container.add(this.homeTextMesh);
    this.water.ignoreObjects.push(this.homeTextMesh);

    // All three lines must be ready before measuring and rendering the shared reveal texture.
    let pendingText = 3;
    const renderText = () => {
      if (--pendingText > 0) return;
      const bounds = this.homeText.bbox = new Box3().setFromObject(this.homeText);
      const halfWidth = Math.max(Math.abs(bounds.min.x), Math.abs(bounds.max.x)) * 1.08;
      const halfHeight = Math.max(Math.abs(bounds.min.y), Math.abs(bounds.max.y)) * 1.08;
      this.homeTextMesh.scale.set(halfWidth * 2, halfHeight * 2, 1);
      this.textCamera.left = -halfWidth;
      this.textCamera.right = halfWidth;
      this.textCamera.top = halfHeight;
      this.textCamera.bottom = -halfHeight;
      this.textCamera.updateProjectionMatrix();
      o.Gl.renderer.setRenderTarget(this.textRT);
      o.Gl.renderer.clear();
      o.Gl.renderer.render(this.textScene, this.textCamera);
      o.Gl.renderer.setRenderTarget(null);
    };
    this.introText.sync(renderText);
    this.titleText.sync(renderText);
    this.descriptorText.sync(renderText);

    this.textFluidSim = new FluidSim({
      raycastPointer: o.mouse.glNormalized,
      raycastCamera: this.camera,
      raycastObject: this.homeTextMesh,
      fluid: {
        resolution: 128,
        force: 20,
        iterations: 1,
        mouseRadius: 0.2,
        pressure: 0.999,
        viscosity: 0.999,
        forceClamp: false,
      },
    } as any);
    this.homeTextMesh.material.uniforms.uFluidTexture.value = this.textFluidSim.velocitySim.texture;

    this.contactText = new Group();
    this.contactText.position.copy(this.objectsData.conta.position);
    this.contactText.rotation.y = -this.objectsData.conta.rotation.z;
    this.container.add(this.contactText);
  }

  buildParticles() {
    this.particles = new InstancedMesh(
      new PlaneGeometry(0.001, 0.001),
      new ShaderMaterial({
        vertexShader: homeDustParticlesBillboardVert,
        fragmentShader: homeDustParticlesNormalmapFrag,
        uniforms: {
          u_baseColor: { value: new Color(16049391) },
          u_time: this.globalUniforms.u_time,
          u_particleTex: { value: this.assets.textures.particle },
          u_lightPos: { value: new Vector3(0.79, 0.24, 0.63) },
        },
        transparent: true,
        depthWrite: false,
      }),
      300,
    );
    const e: number[] = [];
    const t: number[] = [];
    this.instanceDummy.position.set(0, 0, 0);
    this.instanceDummy.rotation.set(0, 0, 0);
    this.instanceDummy.scale.setScalar(1);
    for (let i = 0; i < 300; i++) {
      this.instanceDummy.position.set(MathUtils.randFloat(-0.2, 0.05), 0.09, MathUtils.randFloat(-0.1, 0.3));
      this.instanceDummy.updateMatrix();
      this.particles.setMatrixAt(i, this.instanceDummy.matrix);
      e.push(Math.random());
      t.push(i % 8);
    }
    this.particles.geometry.setAttribute('a_progress', new InstancedBufferAttribute(new Float32Array(e), 1));
    this.particles.geometry.setAttribute('a_uv', new InstancedBufferAttribute(new Float32Array(t), 1));
    this.container.add(this.particles);
    this.water.ignoreObjects.push(this.particles);
  }

  buildFluidSim() {
    this.fluidSim = new FluidSim({
      raycastPointer: o.mouse.glNormalized,
      raycastCamera: this.camera,
      raycastObject: this.water,
    } as any);
    this.water.material.uniforms.uFluidTexture.value = this.fluidSim.velocitySim.texture;
  }

  applyObjectTransforms(e: Object3D, t: string) {
    e.position.copy(this.objectsData[t].position);
    e.rotation.copy(this.objectsData[t].rotation);
    e.scale.copy(this.objectsData[t].scale);
  }

  buildPasses() {
    const pr = o.Gl.renderer.getPixelRatio();
    this.renderPass = new RenderPass(this.scene, this.camera);
    (this.renderPass as any).name = 'HomeContact';
    this.renderPass.enabled = false;
    this.savePass = new SavePass(
      new WebGLRenderTarget(o.window.w * pr, o.window.fullHeight * pr, {
        minFilter: LinearFilter,
        magFilter: LinearFilter,
        depthBuffer: false,
      }),
    );
    (this.savePass as any).name = 'Home Final';
    this.savePass.enabled = false;
    this.transitionPass = new ShaderPass(
      new ShaderMaterial({
        vertexShader: homeTransitionWipeVert,
        fragmentShader: homeTransitionWipeZoomFrag,
        uniforms: {
          u_fromScene: { value: this.savePass.renderTarget.texture },
          u_toScene: { value: null },
          u_noise: { value: o.Gl.assets.textures.gradientNoise },
          u_progress: { value: 0 },
          u_time: this.globalUniforms.u_time,
        },
      }),
    );
    (this.transitionPass as any).name = 'Home Transition';
    this.transitionPass.enabled = false;
    o.Gl.composerPasses.add(this.renderPass, 0);
    o.Gl.composerPasses.add(this.savePass, 1);
    o.Gl.composerPasses.add(this.transitionPass, 30);
  }

  buildHtml() {
    Object.assign(this.dom, {
      contactContent: f('.js-contact-content'),
      viewProjectsBtn: f('.js-view-projects-btn'),
    });
    o.contentToggle = new ContentToggle();
    this.contactBtns = [];
    // Shell markup is optional; both templates must exist before building text.
    if (!this.dom.viewProjectsBtn || !this.dom.contactContent) return;
    this.viewProjectsBtn = new SvgButton(f('.js-btn', this.dom.viewProjectsBtn));
    p('.js-btn', this.dom.contactContent).forEach((e) => {
      this.contactBtns.push(new SvgButton(e));
    });
    this.viewProjectsBtn3D = new CSS3DObject(this.dom.viewProjectsBtn);
    this.viewProjectsBtn3D.position.copy(this.homeTextMesh.position).multiplyScalar(1e3);
    this.viewProjectsBtn3D.position.y -= 17.5;
    this.viewProjectsBtn3D.rotation.copy(this.homeTextMesh.rotation);
    const e = 1e3 * -(this.objectsData.ho.position.z - this.objectsData.cam.children[3].position.z);
    this.viewProjectsBtn3D.scale.setScalar(e / o.Gl.cssRenderer.cache.camera.fov);
    o.Gl.cssScene.add(this.viewProjectsBtn3D);
    this.contactContent3D = new CSS3DObject(this.dom.contactContent);
    this.contactContent3D.position.copy(this.contactText.position).multiplyScalar(1e3);
    this.contactContent3D.rotation.copy(this.contactText.rotation);
    this.contactContent3D.scale.setScalar(100 / o.Gl.cssRenderer.cache.camera.fov);
    o.Gl.cssScene.add(this.contactContent3D);
  }

  buildCameraProps() {
    const e: Vector3[] = [];
    for (let t = 0; t < this.objectsData.cam.children.length; t++) e[t] = this.objectsData.cam.children[t].position;
    this.cameraCurvePath = new CatmullRomCurve3(e);
    const t: Vector3[] = [];
    for (let i = 0; i < this.objectsData.tgt.children.length; i++) t[i] = this.objectsData.tgt.children[i].position;
    this.cameraTargetPath = new CatmullRomCurve3(t);
    this._q = new Quaternion();
    this._e = new Euler();
  }

  updateCameraPosition() {
    const e = this.cameraCurvePath.getPointAt(this.tweenParams.cameraPathProgress);
    const t = this.cameraTargetPath.getPointAt(this.tweenParams.cameraPathProgress);
    if (this.devCam) {
      this.camera.position.copy(this.camPos);
      this.camera.lookAt(this.lookAt);
    } else {
      this.camera.position.copy(e);
      this.camera.lookAt(t);
    }
    this.camera.translateZ(this.options.cameraTranslateZ);
    if (!this.options.disableCursor) {
      this.brownianMotion.update(0.5 * o.clockDelta);
      this.camera.updateMatrix();
      this.camera.matrix.multiply(this.brownianMotion.matrix);
      this.camera.matrix.decompose(this.camera.position, this.camera.quaternion, this.camera.scale);
      if (!o.isTouch) {
        this.camera.translateZ(-this.options.cameraZOffset);
        this._e.set(
          this.smoothMouse.y * this.options.mouseMoveAngleY,
          -this.smoothMouse.x * this.options.mouseMoveAngleX,
          0,
        );
        this._q.setFromEuler(this._e);
        this.camera.quaternion.multiply(this._q);
        this._e.set(0, 0, -0.05 * (this.smoothMouse.x - this.smoothMouse2.x));
        this._q.setFromEuler(this._e);
        this.camera.quaternion.multiply(this._q);
        this.camera.translateZ(this.options.cameraZOffset);
      }
    }
    this.camera.position.y += this.tweenParams.cameraYOffset;
    this.camera.updateMatrixWorld();
  }

  showContact(e = false) {
    this.showUI();
    return gsap
      .timeline()
      .to(this.homeTextMesh.material.uniforms.uOpacity, { value: 0, duration: 1, ease: 'expo.out' }, e ? 0 : 1)
      .to(this.dom.viewProjectsBtn, { autoAlpha: 0, ease: 'expo.out' }, e ? 0 : 1.2)
      .fromTo(
        this.revealAnims(),
        { autoAlpha: 0 },
        {
          autoAlpha: 1,
          stagger: 0.04,
          duration: 1,
          ease: 'power2.out',
          onComplete: () => {
            this.renderCss = true;
          },
        },
        e ? 0 : 2,
      );
  }

  showHome(e = false) {
    this.showUI();
    return gsap
      .timeline()
      .to(
        this.revealAnims(),
        { autoAlpha: 0, stagger: 0.05, duration: 1, ease: 'expo.out' },
        e ? 0 : 0.5,
      )
      .to(this.homeTextMesh.material.uniforms.uOpacity, { value: 1, duration: 1, ease: 'power2.out' }, e ? 0 : 1.6)
      .fromTo(
        this.dom.viewProjectsBtn,
        { autoAlpha: 0 },
        {
          autoAlpha: 1,
          ease: 'power2.out',
          onComplete: () => {
            this.renderCss = true;
          },
        },
        e ? 0.25 : 1.85,
      );
  }

  showUI() {
    if (this.dom.viewProjectsBtn) this.dom.viewProjectsBtn.style.visibility = 'visible';
    if (this.dom.contactContent) this.dom.contactContent.style.visibility = 'visible';
  }

  hideUI() {
    if (this.dom.viewProjectsBtn) this.dom.viewProjectsBtn.style.visibility = 'hidden';
    if (this.dom.contactContent) this.dom.contactContent.style.visibility = 'hidden';
  }

  revealAnims(): HTMLElement[] {
    return this.dom.contactContent ? p('.js-reveal-anim', this.dom.contactContent) : [];
  }

  addEvents() {
    o.RAFCollection.add(this.onRaf, 100);
    n.on('cssrenderer:cacheUpdated', this.updateHtmlScale);
    if (!this.viewProjectsBtn3D) return;
    n.on('click', this.viewProjectsBtn3D.element, this.onProjectsBtnClick);
    n.on('mouseenter', this.viewProjectsBtn3D.element, this.onProjectsBtnEnter);
    n.on('mouseleave', this.viewProjectsBtn3D.element, this.onProjectsBtnLeave);
  }

  load() {
    this.assets = { models: {}, textures: {} };
    const e: Record<string, string> = {
      homeRoom: 'room-1.glb',
      contactRoom: 'room-2.glb',
      chair: 'chair.glb',
      pillows: 'pillows.glb',
      rocks: 'rocks.glb',
      table: 'table-3.glb',
      land: 'land-group.glb',
      grass: 'grass-simple.glb',
    };
    const t: Record<string, string> = {
      homeRoom: 'room-1',
      contactRoom: 'room-2',
      chair: 'chair',
      pillows: 'pillows',
      rock: 'rocks',
      table: 'table',
      pearlMatcap: 'pearl-matcap',
      particle: 'particles',
      skymap: 'skymap-tile',
      aoMap: 'ao',
    };
    for (const k in e) {
      // Resolve home models under the configured asset base URL.
      o.AssetLoader.loadGltf(`${o.assetsUrl}models/home/${e[k]}`).then((g: any) => {
        this.assets.models[k] = g.scene.children[0];
      });
    }
    for (const k in t) {
      o.AssetLoader.loadKtxTexture(assetUrl(`images/home/${t[k]}.ktx2`)).then((tex: any) => {
        this.assets.textures[k] = tex;
      });
    }
    o.AssetLoader.loadTexture(assetUrl('images/home/blade.jpg')).then((tex: any) => {
      this.assets.textures.blade = tex;
    });
    o.AssetLoader.loadGltf(assetUrl('models/home/objectsData.glb')).then((g: any) => {
      this.assets.objectsData = g.scene;
    });
  }

  enable() {
    this.renderPass.enabled = true;
    this.isHome = document.body.classList.contains('home');
    this.tweenParams.cameraPathProgress = this.isHome ? 1 : 0;
    this.addEvents();
    this.fluidSim.addEvents();
    this.textFluidSim.addEvents();
  }

  destroy() {
    o.RAFCollection.remove(this.onRaf);
    n.off('cssrenderer:cacheUpdated', this.updateHtmlScale);
    if (this.viewProjectsBtn3D) {
      n.off('mouseenter', this.viewProjectsBtn3D.element, this.onProjectsBtnEnter);
      n.off('mouseleave', this.viewProjectsBtn3D.element, this.onProjectsBtnLeave);
    }
    this.renderCss = false;
    this.renderPass.enabled = false;
    this.savePass.enabled = false;
    this.transitionPass.enabled = false;
    this.camera.position.set(0, 0, 0);
    this.camera.lookAt(0, 0, 0);
    this.tweenParams.cameraYOffset = 0;
    this.options.cameraTranslateZ = 0;
    o.Gl.renderer.setRenderTarget(null);
    o.Gl.renderer.setScissorTest(false);
    this.resourceTracker.dispose();
    this.fluidSim.removeEvents();
    this.textFluidSim.removeEvents();
  }
}

export function createHomeContact() {
  return new HomeContact();
}

export default createHomeContact;
