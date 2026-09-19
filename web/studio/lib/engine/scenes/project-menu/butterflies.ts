/* eslint-disable @typescript-eslint/no-explicit-any */
// Butterflies: 120 GPGPU-flocked butterflies drawn as one InstancedMesh.
import {
  BufferGeometry,
  DoubleSide,
  FloatType,
  InstancedBufferAttribute,
  InstancedMesh,
  Material,
  MathUtils,
  RepeatWrapping,
  ShaderMaterial,
  Vector2,
  Vector3,
} from "three";
import { store as storeRaw } from "../../core/store";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const store: any = storeRaw;
import { E } from "../../core/event-bus";
import { FBO } from "../../core/fbo";
import { assetUrl } from "../../core/asset-url";
import { projectsButterflyPositionSimFrag } from "../../shaders/projects-butterfly-position-sim.frag.glsl";
import { projectsButterflyVelocityFlockingFrag } from "../../shaders/projects-butterfly-velocity-flocking.frag.glsl";
import { projectsButterflyInstancedVert } from "../../shaders/projects-butterfly-instanced.vert.glsl";
import { projectsButterflyMatcapNormalmapFrag } from "../../shaders/projects-butterfly-matcap-normalmap.frag.glsl";

const SPREAD = 2500;
const HALF_SPREAD = 1250;

export class Butterflies extends InstancedMesh<BufferGeometry, Material | Material[]> {
  centralPosition: Vector3;
  mouse: Vector2;
  assets!: { models: Record<string, any>; textures: Record<string, any> };
  positionSim: any;
  velocitySim: any;
  declare material: any;

  onMouseMove = ({ mousePos }: { mousePos: { x: number; y: number } }) => {
    this.mouse.set(mousePos.x - store.window.w / 2, mousePos.y - store.window.h / 2);
  };

  constructor() {
    // Geometry, material, and instance count are assigned in build();
    // the vertex shader never reads instanceMatrix, so allocating it for 120 instances up front is equivalent.
    super(new BufferGeometry(), undefined as unknown as Material, 120);
    this.centralPosition = new Vector3(0, 0, -200);
    this.mouse = new Vector2(1e4, 1e4);
    this.load();
  }

  build(_globalUniforms?: unknown) {
    this.count = 120;
    const positions: number[] = [];
    for (let t = 0, i = 4 * this.count; t < i; t += 4) {
      const x = Math.random() * SPREAD - HALF_SPREAD,
        y = Math.random() * SPREAD - HALF_SPREAD,
        z = 3e3 * Math.random() - 2e3;
      positions[t + 0] = x + this.centralPosition.x;
      positions[t + 1] = MathUtils.mapLinear(y + this.centralPosition.y, -1250, SPREAD, -200, 1e3);
      positions[t + 2] = z + this.centralPosition.z;
      positions[t + 3] = t % 12 == 0 ? 1 : 2;
    }
    const velocities: number[] = [];
    for (let e = 0, i = 4 * this.count; e < i; e += 4) {
      velocities[e + 0] = Math.random() - 0.5;
      velocities[e + 1] = Math.random() - 0.5;
      velocities[e + 2] = Math.random() - 0.5;
      velocities[e + 3] = 1;
    }

    this.positionSim = new FBO({
      fragmentShader: projectsButterflyPositionSimFrag,
      data: positions,
      count: this.count,
      wrap: RepeatWrapping,
      type: FloatType,
      uniforms: {
        u_velocity: { value: null },
        u_mouse: { value: new Vector3(1e4, 1e4, 0) },
        u_screenResolution: { value: new Vector2(store.window.w, store.window.h) },
      },
    });
    this.velocitySim = new FBO({
      fragmentShader: projectsButterflyVelocityFlockingFrag,
      data: velocities,
      count: this.count,
      wrap: RepeatWrapping,
      type: FloatType,
      uniforms: {
        u_position: { value: null },
        u_separationDistance: { value: 100 },
        u_alignmentDistance: { value: 5 },
        u_cohesionDistance: { value: 5 },
        u_mouse: { value: new Vector3(1e4, 1e4, 0) },
        uCentralPosition: { value: this.centralPosition },
      },
    });
    this.positionSim.uniforms.u_velocity.value = this.velocitySim.texture;
    this.velocitySim.uniforms.u_position.value = this.positionSim.texture;

    this.geometry = this.assets.models.butterfly.geometry;
    this.geometry.scale(16, 16, 16);
    this.geometry.rotateY(MathUtils.degToRad(-90));

    this.material = new ShaderMaterial({
      vertexShader: projectsButterflyInstancedVert,
      fragmentShader: projectsButterflyMatcapNormalmapFrag,
      uniforms: {
        tDiffuse: { value: this.assets.textures.diffuse },
        tNormal: { value: this.assets.textures.normal },
        tLightingMatcap: { value: store.Gl.assets.textures.matcap },
        tMatcap: { value: store.Gl.assets.textures.projectModelMatcap },
        tPosition: { value: null },
        tVelocity: { value: null },
        uNormalMapStrength: { value: 1 },
        ...store.Gl.globalUniforms,
      },
      transparent: true,
      side: DoubleSide,
    });
    this.geometry.setAttribute("aFboUv", this.positionSim.fboUv.attributeInstanced);
    this.geometry.computeTangents();

    const scales: number[] = [],
      offsets: number[] = [];
    for (let e = 0; e < this.count; e++) {
      scales.push(MathUtils.randFloat(0.7, 1));
      const u = MathUtils.randInt(0, 4),
        v = MathUtils.randInt(0, 1);
      7 === u && 1 === v ? offsets.push(0, 0) : offsets.push(u, v);
    }
    this.geometry.setAttribute("aScale", new InstancedBufferAttribute(new Float32Array(scales), 1));
    this.geometry.setAttribute("aUvOffset", new InstancedBufferAttribute(new Float32Array(offsets), 2));
    E.on(store.events.MOUSEMOVE, this.onMouseMove);
  }

  update() {
    this.positionSim.uniforms.u_screenResolution.value.set(store.window.w, store.window.h);
    this.velocitySim.uniforms.u_mouse.value.set(
      (0.5 * this.mouse.x) / (store.window.w / 2),
      (-0.5 * this.mouse.y) / (store.window.h / 2),
      0.1,
    );
    this.positionSim.uniforms.u_mouse.value.copy(this.velocitySim.uniforms.u_mouse.value);
    this.mouse.set(1e4, 1e4);
    this.positionSim.uniforms.u_velocity.value = this.velocitySim.texture;
    this.velocitySim.uniforms.u_position.value = this.positionSim.texture;
    this.velocitySim.update();
    this.positionSim.update();
    this.positionSim.uniforms.u_velocity.value = this.velocitySim.texture;
    this.velocitySim.uniforms.u_position.value = this.positionSim.texture;
    this.material.uniforms.tPosition.value = this.positionSim.texture;
    this.material.uniforms.tVelocity.value = this.velocitySim.texture;
  }

  load() {
    this.assets = { models: {}, textures: {} };
    store.AssetLoader.loadGltf(assetUrl("models/project-menu/butterfly.glb")).then((e: any) => {
      this.assets.models.butterfly = e.scene.children[0];
    });
    store.AssetLoader.loadTexture(assetUrl("images/project-menu/butterfly-atlas-diffuse-1.png"), {
      flipY: false,
    }).then((e: any) => {
      e.anisotropy = store.Gl.renderer.capabilities.getMaxAnisotropy();
      this.assets.textures.diffuse = e;
    });
    store.AssetLoader.loadTexture(assetUrl("images/project-menu/butterfly-atlas-normal-1.png"), {
      flipY: false,
    }).then((e: any) => {
      e.anisotropy = store.Gl.renderer.capabilities.getMaxAnisotropy();
      this.assets.textures.normal = e;
    });
    store.AssetLoader.loadTexture(assetUrl("images/iri-32.png"), { flipY: false }).then((e: any) => {
      this.assets.textures.matcap = e;
    });
  }
}
