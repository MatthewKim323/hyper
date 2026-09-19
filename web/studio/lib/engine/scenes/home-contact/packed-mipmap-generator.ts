import {
  Mesh,
  NearestFilter,
  NoBlending,
  OrthographicCamera,
  PlaneGeometry,
  RawShaderMaterial,
  ShaderMaterial,
  Vector2,
  WebGLRenderTarget,
  type Material,
  type Texture,
  type WebGLRenderer,
} from 'three';
import { homeReflectorMipmapDownsampleVert } from '../../shaders/home-reflector-mipmap-downsample.vert.glsl';
import { homeReflectorMipmapDownsampleFrag } from '../../shaders/home-reflector-mipmap-downsample.frag.glsl';
import { homeReflectorCopyVert } from '../../shaders/home-reflector-copy.vert.glsl';
import { homeReflectorCopyFrag } from '../../shaders/home-reflector-copy.frag.glsl';

/**
 * Packed mip chain generator. Writes a 1.5x wide atlas: level 0 on the left,
 * successive halvings stacked on the right, sampled by `packedTexture2DLOD` in the water shader.
 * The quad uses OrthographicCamera(-1,1,1,-1,0,1) and PlaneGeometry(2,2); `setViewOffset`
 * on its camera is what places each mip level, so three's triangle FullScreenQuad is not used.
 */
class Quad {
  _mesh: Mesh;
  _camera: OrthographicCamera;
  get camera() {
    return this._camera;
  }
  get material() {
    return this._mesh.material as Material;
  }
  set material(e: Material) {
    this._mesh.material = e;
  }
  constructor(e: Material) {
    const t = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const i = new PlaneGeometry(2, 2);
    this._mesh = new Mesh(i, e);
    this._camera = t;
  }
  dispose() {
    this._mesh.geometry.dispose();
  }
  render(e: WebGLRenderer) {
    e.render(this._mesh, this._camera);
  }
}

export class PackedMipMapGenerator {
  material: ShaderMaterial;
  swapTarget: WebGLRenderTarget;
  copyQuad: Quad;
  mipQuad: Quad;
  size: Vector2;
  targetSize: Vector2;
  maxMipMapLevel: number;

  constructor() {
    this.material = new ShaderMaterial({
      vertexShader: homeReflectorMipmapDownsampleVert,
      fragmentShader: homeReflectorMipmapDownsampleFrag,
      uniforms: {
        map: { value: null },
        originalMapSize: { value: new Vector2() },
        parentMapSize: { value: new Vector2() },
        parentLevel: { value: 0 },
      },
    });
    this.swapTarget = new WebGLRenderTarget(1, 1);
    this.swapTarget.texture.minFilter = NearestFilter;
    this.swapTarget.texture.magFilter = NearestFilter;
    this.copyQuad = new Quad(
      new RawShaderMaterial({
        vertexShader: homeReflectorCopyVert,
        fragmentShader: homeReflectorCopyFrag,
        uniforms: { uTexture: { value: null } },
        depthTest: false,
        depthWrite: false,
        blending: NoBlending,
      }),
    );
    this.mipQuad = new Quad(this.material);
    this.size = new Vector2();
    this.targetSize = new Vector2();
    this.maxMipMapLevel = 1;
  }

  resize(e: Vector2, t: WebGLRenderTarget) {
    const i = Math.floor(e.x);
    const s = Math.floor(e.y);
    this.size.set(i, s);
    this.targetSize.set(Math.floor(1.5 * this.size.x), this.size.y);
    this.maxMipMapLevel = 1;
    t.setSize(this.targetSize.x, this.targetSize.y);
    this.swapTarget.setSize(this.targetSize.x, this.targetSize.y);
  }

  update(e: Texture, t: WebGLRenderTarget, i: WebGLRenderer) {
    const s = i.autoClear;
    const o = i.getRenderTarget();
    i.autoClear = false;
    (this.copyQuad.material as RawShaderMaterial).uniforms.uTexture.value = e;
    i.setRenderTarget(this.swapTarget);
    this.copyQuad.render(i);
    let n = this.size.x;
    let r = this.size.y;
    let a = 0;
    while (n > this.maxMipMapLevel && r > this.maxMipMapLevel) {
      this.material.uniforms.map.value = this.swapTarget.texture;
      this.material.uniforms.parentLevel.value = a;
      this.material.uniforms.parentMapSize.value.set(n, r);
      this.material.uniforms.originalMapSize.value.set(this.size.x, this.size.y);
      n = Math.floor(n / 2);
      r = Math.floor(r / 2);
      const y = this.targetSize.y - 2 * r;
      i.setRenderTarget(t);
      this.mipQuad.camera.setViewOffset(n, r, -this.size.x, -y, this.targetSize.x, this.targetSize.y);
      this.mipQuad.render(i);
      i.setRenderTarget(this.swapTarget);
      this.material.uniforms.map.value = t.texture;
      this.mipQuad.render(i);
      a++;
    }
    i.setRenderTarget(o);
    i.autoClear = s;
  }

  dispose() {
    this.swapTarget.dispose();
    this.mipQuad.dispose();
    this.copyQuad.dispose();
  }
}
