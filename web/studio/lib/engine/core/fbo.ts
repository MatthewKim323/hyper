/* eslint-disable @typescript-eslint/no-explicit-any */
// FBO / GPGPU ping-pong.
// NOTE: the first FBO sets renderer.autoClear = false globally.
import {
  BufferAttribute,
  Camera,
  ClampToEdgeWrapping,
  DataTexture,
  HalfFloatType,
  InstancedBufferAttribute,
  LinearEncoding,
  Mesh,
  MeshBasicMaterial,
  NearestFilter,
  PlaneGeometry,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  Texture,
  TextureDataType,
  TextureFilter,
  Vector2,
  WebGLRenderTarget,
  Wrapping,
} from "three";
import { store } from "./store";
import { commonFullscreenUvVert } from "../shaders/common-fullscreen-uv.vert.glsl";

export interface FBOOptions {
  fragmentShader: string;
  uniforms?: Record<string, { value: any }>;
  width?: number;
  height?: number;
  data?: ArrayLike<number> | false;
  count?: number;
  filter?: TextureFilter;
  wrap?: Wrapping;
  type?: TextureDataType;
  createTexture?: boolean;
  pingPong?: boolean;
  autoSwap?: boolean;
}

function sizeFromCount(count: number) {
  const sizes = [4, 16, 64, 256, 1024, 2048, 4096, 8192, 16384, 32768, 65536, 131072, 262144];
  const nearest = sizes.reduce((a, b) => (Math.abs(b - count) < Math.abs(a - count) ? b : a));
  return nearest < count ? Math.sqrt(sizes[sizes.indexOf(nearest) + 1]) : Math.sqrt(nearest);
}

export class FBO {
  width: number;
  height: number;
  count: number;
  uniforms: Record<string, { value: any }>;
  renderTargets: { a?: WebGLRenderTarget; b?: WebGLRenderTarget; read?: WebGLRenderTarget; write?: WebGLRenderTarget } = {};
  texture: Texture | null = null;
  createTexture: boolean;
  pingPong: boolean;
  autoSwap: boolean;
  filter: TextureFilter;
  wrap: Wrapping;
  type: TextureDataType;
  scene: Scene;
  camera: Camera;
  plane!: Mesh<PlaneGeometry, ShaderMaterial>;
  debugPlane!: Mesh<PlaneGeometry, MeshBasicMaterial>;
  baseTexture?: DataTexture;
  fboUv!: { data: Float32Array; attribute: BufferAttribute; attributeInstanced: InstancedBufferAttribute };

  constructor({
    fragmentShader,
    uniforms = {},
    width = 32,
    height = 32,
    data = false,
    count,
    filter,
    wrap,
    type,
    createTexture = true,
    pingPong = true,
    autoSwap = true,
  }: FBOOptions) {
    if (count) {
      this.width = sizeFromCount(count);
      this.height = this.width;
      this.count = count;
    } else {
      this.width = width;
      this.height = height;
      this.count = width * height;
    }
    this.uniforms = uniforms;
    this.createTexture = createTexture;
    this.pingPong = pingPong;
    this.autoSwap = autoSwap;
    this.filter = filter || NearestFilter;
    this.wrap = wrap || ClampToEdgeWrapping;
    this.type = type || HalfFloatType;
    const gl = store.Gl!;
    if (gl.renderer.autoClear !== false) gl.renderer.autoClear = false;
    this.scene = new Scene();
    this.camera = new Camera();
    this.camera.position.z = 1;
    this.buildRenderTargets();
    this.buildPlane(fragmentShader);
    if (this.createTexture) this.buildBaseTexture(data);
    this.buildDebugPlane();
    this.setFboUv();
    this.render();
  }

  buildBaseTexture(data: ArrayLike<number> | false) {
    const len = 4 * this.count;
    const arr = new Float32Array(this.width * this.height * 4);
    if (data)
      for (let s = 0; s < len; s += 4) {
        arr[s + 0] = data[s + 0];
        arr[s + 1] = data[s + 1];
        arr[s + 2] = data[s + 2];
        arr[s + 3] = data[s + 3];
      }
    else
      for (let e = 0; e < len; e += 4) {
        arr[e + 0] = 0;
        arr[e + 1] = 0;
        arr[e + 2] = 0;
        arr[e + 3] = 1;
      }
    this.baseTexture = new DataTexture(arr, this.width, this.height, RGBAFormat, this.type);
    this.baseTexture.minFilter = this.filter;
    this.baseTexture.magFilter = this.filter as any;
    this.baseTexture.generateMipmaps = false;
    this.baseTexture.needsUpdate = true;
    this.uniforms.uBaseTexture.value = this.baseTexture;
    this.uniforms.uTexture.value = this.baseTexture;
  }

  buildRenderTargets() {
    this.renderTargets.a = new WebGLRenderTarget(this.width, this.height, {
      minFilter: this.filter,
      magFilter: this.filter as any,
      wrapS: this.wrap,
      wrapT: this.wrap,
      generateMipmaps: false,
      format: RGBAFormat,
      type: this.type,
      encoding: LinearEncoding,
      depthBuffer: false,
      stencilBuffer: false,
    });
    this.renderTargets.write = this.renderTargets.a;
    if (this.pingPong) {
      this.renderTargets.b = this.renderTargets.a.clone();
      this.renderTargets.read = this.renderTargets.b;
    }
  }

  buildPlane(fragmentShader: string) {
    const gl = store.Gl!;
    Object.assign(this.uniforms, {
      uBaseTexture: { value: null },
      uTexture: { value: null },
      uTime: gl.globalUniforms.u_time,
      uDelta: gl.globalUniforms.u_delta,
      uResolution: { value: new Vector2(this.width, this.height) },
      uCellSize: { value: new Vector2(1 / this.width, 1 / this.height) },
    });
    this.plane = new Mesh(
      new PlaneGeometry(2, 2),
      new ShaderMaterial({ vertexShader: commonFullscreenUvVert, fragmentShader, uniforms: this.uniforms }),
    );
    this.scene.add(this.plane);
  }

  buildDebugPlane() {
    this.debugPlane = new Mesh(new PlaneGeometry(), new MeshBasicMaterial());
  }

  setFboUv() {
    const data = new Float32Array(2 * this.count);
    const hx = 1 / this.width / 2;
    const hy = 1 / this.height / 2;
    for (let i = 0; i < this.count; i++) {
      data[2 * i + 0] = (i % this.width) / this.width + hx;
      data[2 * i + 1] = Math.floor(i / this.width) / this.height + hy;
    }
    this.fboUv = {
      data,
      attribute: new BufferAttribute(data, 2),
      attributeInstanced: new InstancedBufferAttribute(data, 2),
    };
  }

  render() {
    const renderer = store.Gl!.renderer;
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(this.renderTargets.write!);
    renderer.render(this.scene, this.camera);
    renderer.setRenderTarget(prev);
    if (this.pingPong && this.autoSwap) this.swap();
    else this.texture = this.renderTargets.write!.texture;
    this.debugPlane.material.map = this.texture;
  }

  swap() {
    const w = this.renderTargets.write;
    this.renderTargets.write = this.renderTargets.read;
    this.renderTargets.read = w;
    this.texture = this.renderTargets.read!.texture;
  }

  update(useTexture = true) {
    if (useTexture) {
      if (this.pingPong) this.uniforms.uTexture.value = this.renderTargets.read!.texture;
      else this.uniforms.uTexture.value = this.renderTargets.write!.texture;
    }
    this.render();
  }

  setSize(width: number, height: number) {
    this.renderTargets.a!.setSize(width, height);
    if (this.renderTargets.b) this.renderTargets.b.setSize(width, height);
    this.uniforms.uResolution.value.set(width, height);
    this.uniforms.uCellSize.value.set(1 / width, 1 / height);
  }

  destroy() {
    this.renderTargets.a!.dispose();
    if (this.renderTargets.b) this.renderTargets.b.dispose();
    this.uniforms.uTexture.value?.dispose();
    if (this.baseTexture) this.baseTexture.dispose();
  }
}

export default FBO;
